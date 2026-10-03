// Seat expiry, waitlist promotion and confirm-versus-expiry races. Needs API + worker running.
// For the race part, run the workers with a short interval so ticks land on the deadlines:
//   powershell -File dev-restart.ps1 -Workers 2 -WorkerIntervalMs 300
import {
  api, newUser, enter, myStatus, confirm, adminCall, pmap, rid, sleep, dbClient, redisClient, flushRedis,
  CACHE_PATTERNS, resetDrop, suite, eq, ok, TEST_KEY,
} from './lib.mjs';
import { checkInvariants } from './invariants.mjs';

if (!TEST_KEY) { console.error('Set TEST_KEY.'); process.exit(1); }
const db = await dbClient();
const redis = await redisClient();
for (const id of ['test-race', 'test-expire']) await resetDrop(db, redis, id);
await flushRedis(redis, CACHE_PATTERNS);

const { t, done } = suite('Expiry, promotion and deadline races');

// ---------------------------------------------------------------- confirm racing the deadline
await t('15 rounds of confirms landing on the deadline while workers tick: no oversell, no double seat', async () => {
  const D = 'test-race';
  const users = await pmap(Array.from({ length: 60 }), () => newUser('dl'), 10);
  await pmap(users, (u) => enter(u, D), 10);
  const byId = new Map(users.map((u) => [u.id, u]));
  eq((await adminCall('POST', `/admin/drops/${D}/close`)).status, 200);
  eq((await adminCall('POST', `/admin/drops/${D}/draw`)).status, 200);

  const outcomes = { ok: 0, expired: 0, notWinner: 0, already: 0, other: [] };
  for (let round = 0; round < 25; round++) {
    const pend = await db.query(
      "SELECT e.user_id FROM seat_slots s JOIN entries e ON e.id = s.entry_id WHERE s.drop_id = $1 AND s.state = 'PENDING'", [D]);
    if (!pend.rowCount) break;
    await db.query("UPDATE seat_slots SET confirm_by = now() + interval '1200 milliseconds' WHERE drop_id = $1 AND state = 'PENDING'", [D]);
    await Promise.all(pend.rows.map(async ({ user_id: userId }) => {
      const u = byId.get(userId);
      // about a third never confirm, so seats keep expiring and moving down the waitlist
      if (Math.random() < 0.35) return;
      // land anywhere from 0.4 s before to 0.4 s after the deadline
      await sleep(800 + Math.random() * 800);
      const r = await confirm(u, D, `card-${rid()}`, 'Racer');
      if (r.status === 200) outcomes.ok++;
      else if (r.code === 'CONFIRM_WINDOW_EXPIRED') outcomes.expired++;
      else if (r.code === 'NOT_A_WINNER') outcomes.notWinner++;
      else if (r.code === 'ALREADY_CONFIRMED') outcomes.already++;
      else outcomes.other.push([r.status, r.code]);
    }));
    await sleep(700);
  }
  console.log(`      outcomes: ${JSON.stringify(outcomes)}`);
  eq(outcomes.other, [], 'only documented outcomes, no 5xx');
  eq(await checkInvariants(db, D), [], 'invariants');
  const confirmed = (await db.query("SELECT COUNT(*)::int AS n FROM seat_slots WHERE drop_id = $1 AND state = 'CONFIRMED'", [D])).rows[0].n;
  eq(confirmed, outcomes.ok, 'every 200 is exactly one confirmed seat');
  ok(confirmed <= 3, 'at most 3 seats');
});

// ---------------------------------------------------------------- the full expiry chain
await t('nobody confirms: seats expire, waitlist #1 gets one, the other is unfilled, drop completes', async () => {
  const D = 'test-expire';
  const startedAt = (await db.query('SELECT clock_timestamp() AS t')).rows[0].t;
  const users = await pmap(Array.from({ length: 3 }), () => newUser('exp'), 3);
  await pmap(users, (u) => enter(u, D), 3);
  eq((await adminCall('POST', `/admin/drops/${D}/close`)).status, 200);
  eq((await adminCall('POST', `/admin/drops/${D}/draw`)).status, 200);

  const st = await pmap(users, async (u) => ({ u, s: (await myStatus(u, D)).data }), 3);
  const winners = st.filter((x) => x.s.state === 'WON').map((x) => x.u);
  const waiting = st.find((x) => x.s.state === 'WAITLISTED');
  eq([winners.length, waiting.s.waitlistPosition], [2, 1], 'two winners, waitlisted at #1');
  console.log('      waiting for the 1 minute confirm window and the worker ...');

  let promoted = false;
  for (let i = 0; i < 120 && !promoted; i++) {
    await sleep(1000);
    promoted = (await myStatus(waiting.u, D)).data.state === 'WON';
  }
  ok(promoted, 'waitlisted user was promoted');
  for (const w of winners) eq((await myStatus(w, D)).data.state, 'EXPIRED', 'original winner expired');
  const late = await confirm(winners[0], D, `late-${rid()}`);
  eq([late.status, late.code], [410, 'CONFIRM_WINDOW_EXPIRED'], 'late confirm refused');
  const slots = (await db.query('SELECT state FROM seat_slots WHERE drop_id = $1 ORDER BY slot_no', [D])).rows.map((r) => r.state).sort();
  eq(slots, ['PENDING', 'UNFILLED'], 'one seat re-offered, one unfilled');
  eq(await checkInvariants(db, D), [], 'invariants after first expiry');
  const p = (await myStatus(waiting.u, D)).data;
  ok(p.confirmBy && new Date(p.confirmBy) > new Date(), 'promoted user has a fresh deadline');

  let state = 'DRAWN';
  for (let i = 0; i < 120 && state !== 'COMPLETE'; i++) {
    await sleep(1000);
    state = (await api('GET', `/drops/${D}`)).data.state;
  }
  eq(state, 'COMPLETE', 'drop completes');
  eq((await myStatus(waiting.u, D)).data.state, 'EXPIRED');
  const slots2 = (await db.query('SELECT state FROM seat_slots WHERE drop_id = $1', [D])).rows.map((r) => r.state);
  eq(slots2, ['UNFILLED', 'UNFILLED']);
  eq(await checkInvariants(db, D), [], 'invariants at the end');

  const audit = (await db.query('SELECT type, COUNT(*)::int AS n FROM audit_log WHERE drop_id = $1 AND at >= $2 GROUP BY 1', [D, startedAt])).rows;
  const by = Object.fromEntries(audit.map((r) => [r.type, r.n]));
  eq([by.EXPIRED, by.PROMOTED, by.UNFILLED, by.COMPLETE], [3, 1, 2, 1], `audit trail ${JSON.stringify(by)}`);
});

const failed = done();
await db.end();
redis.disconnect();
process.exit(failed ? 1 : 0);
