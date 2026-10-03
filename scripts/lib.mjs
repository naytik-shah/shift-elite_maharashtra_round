// Shared helpers for the test scripts (edge tests, resilience test, load test).
import crypto from 'node:crypto';
import pg from 'pg';

export const BASE = process.env.BASE_URL || 'http://localhost:3000/api/v1';
export const TEST_KEY = process.env.TEST_KEY || '';
export const DATABASE_URL = process.env.DATABASE_URL || 'postgres://fairdrop:fairdrop@127.0.0.1:5433/fairdrop';
export const ORGANISER = process.env.ORGANISER_EMAIL || 'organiser@fairdrop.test';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const rid = () => crypto.randomBytes(5).toString('hex');

// Every call gets its own address in its own /24, so nothing here trips the per-IP or subnet limits by accident.
let ipCounter = crypto.randomInt(0, 60000);
export function nextIp() {
  const n = ipCounter++ % 65536;
  return `10.${(n >> 8) & 255}.${n & 255}.7`;
}

export async function api(method, path, { cookie, body, ip, headers = {}, raw, testKey = TEST_KEY, idem = true, contentType = 'application/json' } = {}) {
  const h = { ...headers };
  if (contentType) h['Content-Type'] = contentType;
  if (idem && method !== 'GET' && !h['Idempotency-Key']) h['Idempotency-Key'] = crypto.randomUUID();
  if (cookie) h.Cookie = cookie;
  if (testKey) h['X-Test-Key'] = testKey;
  if (ip) h['X-Test-Client-IP'] = ip;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  const sid = setCookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('sid='));
  return { status: res.status, data, cookie: sid, headers: res.headers, code: data?.error?.code };
}

export function leadingZeroBits(buf) {
  let bits = 0;
  for (const byte of buf) {
    if (byte === 0) { bits += 8; continue; }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export function solveNonce(prefix, difficulty, { fail = false } = {}) {
  for (let nonce = 0; ; nonce++) {
    const bits = leadingZeroBits(crypto.createHash('sha256').update(prefix + nonce).digest());
    if (fail ? bits < difficulty : bits >= difficulty) return String(nonce);
  }
}

export async function getChallenge(purpose, ip, opts = {}) {
  const r = await api('GET', `/pow/challenge?purpose=${purpose}`, { ip, ...opts });
  if (r.status !== 200) throw new Error(`challenge failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

export async function solvePow(purpose, ip) {
  const ch = await getChallenge(purpose, ip);
  return { challengeId: ch.challengeId, nonce: solveNonce(ch.prefix, ch.difficulty) };
}

export async function login(email, ip) {
  const pow = await solvePow('otp', ip);
  const req = await api('POST', '/auth/otp/request', { body: { email, pow }, ip });
  if (!req.data?.devCode) throw new Error(`no devCode for ${email}: ${req.status} ${JSON.stringify(req.data)}`);
  const ver = await api('POST', '/auth/otp/verify', { body: { email, code: req.data.devCode }, ip });
  if (ver.status !== 200 || !ver.cookie) throw new Error(`login failed for ${email}: ${ver.status} ${JSON.stringify(ver.data)}`);
  return { cookie: ver.cookie, user: ver.data.user };
}

export async function newUser(prefix = 'u') {
  const ip = nextIp();
  const email = `${prefix}.${rid()}@fairdrop.test`;
  const { cookie, user } = await login(email, ip);
  return { email, ip, cookie, id: user.id };
}

export async function enter(user, dropId, fp) {
  const pow = await solvePow('entry', user.ip);
  return api('POST', `/drops/${dropId}/entries`, { cookie: user.cookie, ip: user.ip, body: { pow, deviceFingerprint: fp ?? rid() } });
}

export const myStatus = async (u, dropId) => (await api('GET', `/drops/${dropId}/entries/me`, { cookie: u.cookie, ip: u.ip }));
export const confirm = (u, dropId, card, name = 'Test Payer') =>
  api('POST', `/drops/${dropId}/entries/me/confirm`, { cookie: u.cookie, ip: u.ip, body: { testCard: card, payerName: name } });

let adminCache = null;
export async function admin() {
  if (!adminCache) {
    const ip = nextIp();
    const { cookie } = await login(ORGANISER, ip);
    adminCache = { cookie, ip };
  }
  return adminCache;
}
export const adminCall = async (method, path) => {
  const a = await admin();
  return api(method, path, { cookie: a.cookie, ip: a.ip });
};

// Runs fn over items with at most `conc` in flight.
export async function pmap(items, fn, conc = 25) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

export function rankEntries(seed, entries) {
  return entries
    .map(({ entryId, weight }) => {
      const h = crypto.createHmac('sha256', seed).update(entryId).digest('hex');
      const u = (parseInt(h.slice(0, 13), 16) + 1) / (2 ** 52 + 1);
      return { entryId, key: Math.log(u) / Number(weight) };
    })
    .sort((a, b) => (b.key - a.key) || (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0))
    .map((e) => e.entryId);
}

export async function dbClient() {
  const c = new pg.Client({ connectionString: DATABASE_URL });
  c.on('error', () => {}); // a test may stop Postgres on purpose; the script reconnects itself
  await c.connect();
  return c;
}

// Minimal test runner: sequential, prints PASS/FAIL, exits non-zero on failure.
export function suite(title) {
  const results = [];
  const started = Date.now();
  console.log(`\n=== ${title} ===`);
  return {
    async t(name, fn) {
      const t0 = Date.now();
      try {
        await fn();
        results.push({ name, ok: true });
        console.log(`PASS  ${name}  (${Date.now() - t0} ms)`);
      } catch (err) {
        results.push({ name, ok: false });
        console.log(`FAIL  ${name}\n      ${String(err.message).split('\n').join('\n      ')}`);
      }
    },
    done() {
      const failed = results.filter((r) => !r.ok).length;
      console.log(`\n${results.length - failed} passed, ${failed} failed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      return failed;
    },
  };
}

export function eq(actual, expected, label = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label ? `${label}: ` : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
export function ok(cond, label) {
  if (!cond) throw new Error(label || 'condition was false');
}
export function expectErr(r, status, code, label = '') {
  if (r.status !== status || r.code !== code) {
    throw new Error(`${label ? `${label}: ` : ''}expected ${status} ${code}, got ${r.status} ${r.code ?? JSON.stringify(r.data)}`);
  }
}

export const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6380';

export async function redisClient() {
  const { default: Redis } = await import('ioredis');
  const r = new Redis(REDIS_URL);
  r.on('error', () => {}); // tests stop Redis on purpose
  return r;
}

// Deletes keys matching the patterns (SCAN + DEL), returns how many were removed.
export async function flushRedis(redis, patterns) {
  let removed = 0;
  for (const pattern of patterns) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
      cursor = next;
      if (keys.length) { await redis.del(...keys); removed += keys.length; }
    } while (cursor !== '0');
  }
  return removed;
}

export const CACHE_PATTERNS = ['cache:*', 'rl:*', 'pow:*', 'powreq:*', 'otp:*', 'idem:*', 'stats:*', 'mailq'];

// Puts a test drop back to OPEN with no entries and a fresh seed.
export async function resetDrop(db, redis, dropId) {
  const seed = crypto.randomBytes(32).toString('hex');
  const commit = sha256(seed);
  await db.query('BEGIN');
  try {
    await db.query('DELETE FROM tickets WHERE slot_id IN (SELECT id FROM seat_slots WHERE drop_id = $1)', [dropId]);
    await db.query('DELETE FROM seat_slots WHERE drop_id = $1', [dropId]);
    await db.query('DELETE FROM risk_signals WHERE entry_id IN (SELECT id FROM entries WHERE drop_id = $1)', [dropId]);
    await db.query('DELETE FROM entries WHERE drop_id = $1', [dropId]);
    const r = await db.query(
      `UPDATE drops SET state = 'OPEN', manifest_hash = NULL, seed_revealed = NULL, cursor_rank = 0,
              scoring_started_at = NULL, scored_at = NULL, seed_commit = $2 WHERE id = $1`,
      [dropId, commit],
    );
    if (!r.rowCount) throw new Error(`No drop called ${dropId}`);
    await db.query('UPDATE drop_secrets SET seed = $2 WHERE drop_id = $1', [dropId, seed]);
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  }
  return commit;
}
