// Fair Drop MVP smoke test
// Runs the full flow against a running backend and checks the database directly.
// Needs the server's TEST_KEY so test users get login codes, their own test IPs and easy puzzles.
// Parts of the backend that are not built yet are reported as SKIP instead of FAIL.
// Needs Node 18+ and the pg package (npm install pg).

import crypto from "node:crypto";
import pg from "pg";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000/api/v1";
const DATABASE_URL = process.env.DATABASE_URL || "postgres://fairdrop:fairdrop@localhost:5432/fairdrop";
const DROP_ID = process.env.DROP_ID || "smoke-test";
const ORGANISER_EMAIL = process.env.ORGANISER_EMAIL || "organiser@fairdrop.test";
const USERS = Number(process.env.USERS || 100);
const TEST_KEY = process.env.TEST_KEY || "";
const BATCH = 20;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, status: ok ? "PASS" : "FAIL" });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
function skip(name, reason) {
  results.push({ name, status: "SKIP" });
  console.log(`SKIP  ${name}  (${reason})`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

let ipCounter = 1;
const nextTestIp = () => {
  const n = ipCounter++;
  // every user gets their own /24 so honest test users never look like a cluster
  return `10.${(n >> 8) & 255}.${n & 255}.${2 + (n % 250)}`;
};

async function api(method, path, { cookie, body, ip } = {}) {
  const headers = { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() };
  if (cookie) headers.Cookie = cookie;
  if (TEST_KEY) headers["X-Test-Key"] = TEST_KEY;
  if (ip) headers["X-Test-Client-IP"] = ip;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  const raw = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")].filter(Boolean);
  const sid = raw.map((c) => c.split(";")[0]).find((c) => c.startsWith("sid="));
  return { status: res.status, data, cookie: sid };
}

const errCode = (r) => r.data?.error?.code;

// Proof-of-work: find a nonce so SHA-256(prefix + nonce) starts with `difficulty` zero bits.
let powAvailable = true;
function leadingZeroBits(buf) {
  let bits = 0;
  for (const byte of buf) {
    if (byte === 0) { bits += 8; continue; }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}
async function solvePow(purpose, ip) {
  if (!powAvailable) return undefined;
  const ch = await api("GET", `/pow/challenge?purpose=${purpose}`, { ip });
  if (ch.status === 404) { powAvailable = false; return undefined; }
  const { challengeId, prefix, difficulty } = ch.data;
  for (let nonce = 0; ; nonce++) {
    const digest = crypto.createHash("sha256").update(prefix + nonce).digest();
    if (leadingZeroBits(digest) >= difficulty) return { challengeId, nonce: String(nonce) };
  }
}

async function login(email, ip) {
  const pow = await solvePow("otp", ip);
  const req = await api("POST", "/auth/otp/request", { body: { email, pow }, ip });
  const code = req.data?.devCode;
  if (!code) throw new Error(`No devCode for ${email}. Is TEST_KEY set and correct?`);
  const ver = await api("POST", "/auth/otp/verify", { body: { email, code }, ip });
  if (ver.status !== 200 || !ver.cookie) throw new Error(`Login failed for ${email} (status ${ver.status})`);
  return ver.cookie;
}

async function enter(user, fp) {
  const pow = await solvePow("entry", user.ip);
  return api("POST", `/drops/${DROP_ID}/entries`, { cookie: user.cookie, ip: user.ip, body: { pow, deviceFingerprint: fp } });
}

const myStatus = async (u) => (await api("GET", `/drops/${DROP_ID}/entries/me`, { cookie: u.cookie, ip: u.ip })).data;

const confirm = (u, testCard, payerName) =>
  api("POST", `/drops/${DROP_ID}/entries/me/confirm`, { cookie: u.cookie, ip: u.ip, body: { testCard, payerName } });

async function inBatches(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += BATCH) {
    out.push(...(await Promise.all(items.slice(i, i + BATCH).map(fn))));
  }
  return out;
}

// Same ranking rule as MVP.md Section 6
function rankEntries(seed, manifestEntries) {
  return manifestEntries
    .map(({ entryId, weight }) => {
      const h = crypto.createHmac("sha256", seed).update(entryId).digest("hex");
      const u = (parseInt(h.slice(0, 13), 16) + 1) / (2 ** 52 + 1);
      return { entryId, key: Math.log(u) / Number(weight) };
    })
    .sort((a, b) => (b.key - a.key) || (a.entryId < b.entryId ? -1 : 1))
    .map((e) => e.entryId);
}

async function waitFor(fn, timeoutMs, everyMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(everyMs);
  }
  return false;
}

async function main() {
  const runTag = Date.now().toString(36);
  console.log(`Fair Drop MVP smoke test, drop "${DROP_ID}", ${USERS} users\n`);

  const drop = await api("GET", `/drops/${DROP_ID}`);
  if (drop.status !== 200) throw new Error(`Drop ${DROP_ID} not found`);
  const { seats, seedCommit, confirmWindowMinutes } = drop.data;
  check("Drop is open before the test", drop.data.state === "OPEN", `state ${drop.data.state}`);
  check("Seed hash is published before the draw", Boolean(seedCommit));

  // 1. Users log in and enter
  // random names so honest test users do not look like sequential sign-ups
  const emails = Array.from({ length: USERS }, () => `${crypto.randomBytes(5).toString("hex")}.${runTag}@fairdrop.test`);
  const users = await inBatches(emails, async (email) => {
    const ip = nextTestIp();
    const cookie = await login(email, ip);
    const user = { email, ip, cookie };
    const entry = await enter(user, crypto.randomBytes(8).toString("hex"));
    return { ...user, entryStatus: entry.status };
  });
  if (!powAvailable) skip("Proof-of-work puzzles", "/pow/challenge not built yet");
  const entered = users.filter((u) => u.entryStatus === 201).length;
  check("Every user can enter once", entered === USERS, `${entered}/${USERS} entered`);

  // 2. Second entry attempts are rejected
  const repeats = await inBatches(users, (u) => enter(u, "repeat"));
  const rejected = repeats.filter((r) => r.status === 409 && errCode(r) === "ALREADY_ENTERED").length;
  check("Second entry is rejected for every user", rejected === USERS, `${rejected}/${USERS} rejected`);

  // 3. Close, then a late entry
  const adminIp = nextTestIp();
  const admin = await login(ORGANISER_EMAIL, adminIp);
  const close = await api("POST", `/admin/drops/${DROP_ID}/close`, { cookie: admin, ip: adminIp });
  check("Organiser can close entries", close.status === 200, `status ${close.status}`);

  const lateIp = nextTestIp();
  const lateUser = { ip: lateIp, cookie: await login(`late.${runTag}@fairdrop.test`, lateIp) };
  const late = await enter(lateUser, "late");
  check("Entry after close is rejected", late.status === 409 && errCode(late) === "DROP_NOT_OPEN", `status ${late.status}`);

  // 4. Scoring (if built), then two draw clicks at the same moment
  const score = await api("POST", `/admin/drops/${DROP_ID}/score`, { cookie: admin, ip: adminIp });
  if (score.status === 404) {
    skip("Scoring runs once", "score endpoint not built yet");
  } else {
    check("Scoring runs", score.status === 200, `status ${score.status}`);
    const again = await api("POST", `/admin/drops/${DROP_ID}/score`, { cookie: admin, ip: adminIp });
    check("Scoring runs only once", again.status === 409 && errCode(again) === "INVALID_STATE", `status ${again.status}`);
  }

  const draws = await Promise.all([
    api("POST", `/admin/drops/${DROP_ID}/draw`, { cookie: admin, ip: adminIp }),
    api("POST", `/admin/drops/${DROP_ID}/draw`, { cookie: admin, ip: adminIp }),
  ]);
  const drawOk = draws.filter((d) => d.status === 200).length;
  const drawBlocked = draws.filter((d) => d.status === 409).length;
  check("Double draw click runs the draw exactly once", drawOk === 1 && drawBlocked === 1, `${drawOk} ran, ${drawBlocked} blocked`);

  // 5. Revealed seed matches the published hash
  const draw = await api("GET", `/drops/${DROP_ID}/draw`);
  const seed = draw.data?.seed;
  check("Revealed seed matches the published hash", Boolean(seed) && sha256(seed) === seedCommit);

  // 6. Manifest hash and independent re-run of the draw
  const manifest = await api("GET", `/drops/${DROP_ID}/draw/manifest`);
  const ranking = await api("GET", `/drops/${DROP_ID}/draw/results`);
  if (manifest.status === 404 || ranking.status === 404) {
    skip("Manifest and draw re-run", "manifest or results endpoint not built yet");
  } else {
    const entries = manifest.data.entries.map(({ entryId, weight }) => ({ entryId, weight: Number(weight) }));
    check("Manifest matches its published hash", sha256(JSON.stringify(entries)) === draw.data.manifestHash);
    if (score.status !== 404) {
      const lowered = entries.filter((e) => e.weight < 1).length;
      check("No honest test user lost weight in scoring", lowered === 0, `${lowered} lowered`);
    }
    const recomputed = rankEntries(seed, entries);
    const same = recomputed.length === ranking.data.ranking.length
      && recomputed.every((id, i) => id === ranking.data.ranking[i]);
    check("Re-running the draw gives the same ranking", same, `${recomputed.length} entries`);
  }

  // 7. Winners and waitlist
  const statuses = await inBatches(users, async (u) => ({ ...u, status: await myStatus(u) }));
  const winners = statuses.filter((u) => u.status?.state === "WON");
  const waitlisted = statuses
    .filter((u) => u.status?.state === "WAITLISTED")
    .sort((a, b) => a.status.waitlistPosition - b.status.waitlistPosition);
  const expectedWinners = Math.min(seats, USERS);
  check("Number of winners equals seats", winners.length === expectedWinners, `${winners.length} won, expected ${expectedWinners}`);
  check("Everyone else is waitlisted", waitlisted.length === USERS - expectedWinners, `${waitlisted.length} waitlisted`);
  const positionsOk = waitlisted.every((u, i) => u.status.waitlistPosition === i + 1);
  check("Waitlist positions run 1, 2, 3 and so on", positionsOk);

  // 8. Two winners, same card, same moment
  let raceWinner = null;
  if (winners.length >= 3) {
    const sharedCard = `test_card_shared_${runTag}`;
    const [a, b] = winners;
    const race = await Promise.all([confirm(a, sharedCard, "Winner A"), confirm(b, sharedCard, "Winner B")]);
    const raceOk = race.filter((r) => r.status === 200).length;
    const raceBlocked = race.filter((r) => r.status === 409 && errCode(r) === "ANCHOR_ALREADY_USED").length;
    check("Same card cannot confirm two seats", raceOk === 1 && raceBlocked === 1, `${raceOk} confirmed, ${raceBlocked} blocked`);
    raceWinner = race[0].status === 200 ? a : b;
  } else {
    skip("Same card cannot confirm two seats", "needs at least 3 winners");
  }

  // Leave the last winner unconfirmed on purpose, confirm everyone else with their own card
  const holdout = winners[winners.length - 1];
  const pending = [];
  for (const w of winners.slice(0, -1)) {
    if ((await myStatus(w))?.state === "WON") pending.push(w);
  }
  const confirms = await inBatches(pending, (w) => confirm(w, `test_card_${w.email}`, w.email.split("@")[0]));
  const confirmedNow = confirms.filter((r) => r.status === 200).length;
  check("Winners with their own card can confirm", confirmedNow === pending.length, `${confirmedNow}/${pending.length}`);

  // 9. Waitlisted user cannot confirm, winner cannot confirm twice
  if (waitlisted.length > 1) {
    const r = await confirm(waitlisted[waitlisted.length - 1], `test_card_wl_${runTag}`, "Waitlisted");
    check("Waitlisted user cannot confirm", r.status === 403 && errCode(r) === "NOT_A_WINNER", `status ${r.status}`);
  }
  if (raceWinner) {
    const r = await confirm(raceWinner, `test_card_again_${runTag}`, "Again");
    check("Winner cannot confirm twice", r.status === 409 && errCode(r) === "ALREADY_CONFIRMED", `status ${r.status}`);
  }

  // 10. Expiry and promotion
  if (!holdout || waitlisted.length === 0) {
    skip("Unconfirmed seat moves to waitlist #1", "needs a winner and a waitlist");
  } else if (confirmWindowMinutes > 2) {
    skip("Unconfirmed seat moves to waitlist #1", `confirm window is ${confirmWindowMinutes} min, set it to 1 for testing`);
  } else {
    const first = waitlisted[0];
    console.log(`\nWaiting for the ${confirmWindowMinutes} minute confirm window to pass...`);
    await sleep(confirmWindowMinutes * 60_000);
    const moved = await waitFor(async () =>
      (await myStatus(holdout))?.state === "EXPIRED" && (await myStatus(first))?.state === "WON", 60_000);
    check("Unconfirmed seat moves to waitlist #1", moved);
    if (moved) {
      const r = await confirm(first, `test_card_${first.email}`, "Promoted");
      check("Promoted user can confirm", r.status === 200, `status ${r.status}`);
      const lastWaiting = waitlisted[waitlisted.length - 1];
      const completed = await waitFor(async () =>
        (await api("GET", `/drops/${DROP_ID}`)).data?.state === "COMPLETE"
        && (await myStatus(lastWaiting))?.state === "NOT_SELECTED", 60_000);
      check("Drop completes and the rest become Not selected", completed);
    }
  }

  // 11. Database checks
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const entryCount = (await db.query(
      "SELECT COUNT(*)::int AS n FROM entries WHERE drop_id = $1", [DROP_ID])).rows[0].n;
    const slots = await db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE state = 'CONFIRMED')::int AS confirmed
       FROM seat_slots WHERE drop_id = $1`, [DROP_ID]);
    const { total, confirmed } = slots.rows[0];
    check("Seat slots equal min(seats, entries)", total === Math.min(seats, entryCount), `${total} slots, ${seats} seats, ${entryCount} entries`);
    check("Confirmed seats never exceed seats", confirmed <= seats, `${confirmed} confirmed`);

    const cardTwice = await db.query(
      `SELECT anchor_hash FROM seat_slots
       WHERE drop_id = $1 AND anchor_hash IS NOT NULL
       GROUP BY anchor_hash HAVING COUNT(*) > 1`, [DROP_ID]);
    check("No card holds two seats", cardTwice.rowCount === 0, `${cardTwice.rowCount} found`);

    const userTwice = await db.query(
      `SELECT user_id FROM entries WHERE drop_id = $1
       GROUP BY user_id HAVING COUNT(*) > 1`, [DROP_ID]);
    check("No user has two entries", userTwice.rowCount === 0, `${userTwice.rowCount} found`);

    const tickets = await db.query(
      `SELECT COUNT(*)::int AS n FROM tickets t
       JOIN seat_slots s ON s.id = t.slot_id WHERE s.drop_id = $1`, [DROP_ID]);
    check("Tickets match confirmed seats", tickets.rows[0].n === confirmed, `${tickets.rows[0].n} tickets`);

    try {
      const audit = await db.query("SELECT seq, type, payload, prev_hash, hash FROM audit_log ORDER BY seq");
      let prev = "0".repeat(64);
      let broken = 0;
      for (const row of audit.rows) {
        const expected = sha256(`${prev}|${row.seq}|${row.type}|${row.payload}`);
        if (row.prev_hash !== prev || row.hash !== expected) broken++;
        prev = row.hash;
      }
      check("Audit chain is unbroken", audit.rowCount > 0 && broken === 0, `${audit.rowCount} rows, ${broken} broken`);
    } catch {
      skip("Audit chain is unbroken", "audit_log table not built yet");
    }
  } finally {
    await db.end();
  }

  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  console.log(`\n${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`Test stopped: ${err.message}`);
  process.exit(1);
});
