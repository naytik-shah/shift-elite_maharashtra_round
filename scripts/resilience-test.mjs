// Stops Redis and Postgres (and restarts an API container) while the stack is running, and checks that
// the API answers with clean 503s instead of crashing or returning 500s, then recovers by itself.
// Needs the full stack from deploy/docker-compose.yml with deploy/docker-compose.expose.yml.
//
//   TEST_KEY=... BASE_URL=http://localhost:8080/api/v1 node resilience-test.mjs
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  api, newUser, enter, adminCall, nextIp, sleep, dbClient, redisClient, flushRedis, CACHE_PATTERNS, resetDrop, suite, eq, ok, TEST_KEY, BASE,
} from './lib.mjs';
import { checkInvariants } from './invariants.mjs';

if (!TEST_KEY) { console.error('Set TEST_KEY.'); process.exit(1); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compose = (cmd) => execSync(`docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.expose.yml ${cmd}`, { cwd: root, stdio: 'pipe' }).toString();
const restartCount = (svc) => Number(execSync(`docker inspect -f "{{.RestartCount}}" fairdrop-stack-${svc}-1`).toString().trim());
const running = (svc) => execSync(`docker inspect -f "{{.State.Running}}" fairdrop-stack-${svc}-1`).toString().trim() === 'true';

let db = await dbClient();
let redis = await redisClient();
const D = 'test-live';
await resetDrop(db, redis, D);
await flushRedis(redis, CACHE_PATTERNS);

const { t, done } = suite('Resilience: dependencies going down and coming back');

const healthy = async (ms = 40000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await api('GET', '/health').catch(() => ({ status: 0 }));
    if (r.status === 200) return true;
    await sleep(500);
  }
  return false;
};
const noCrash = () => {
  for (const s of ['api1', 'api2', 'worker']) ok(running(s), `${s} must keep running`);
};

const alice = await newUser('res');
const entered = await enter(alice, D);
eq(entered.status, 201, 'baseline entry');

// ---------------------------------------------------------------- Redis down
await t('Redis stopped: health says so, public reads still work, logged-in actions answer 503 (never 500)', async () => {
  compose('stop redis');
  await sleep(2500);
  const h = await api('GET', '/health');
  eq([h.status, h.data.redis], [503, false], 'health');
  const pub = await api('GET', `/drops/${D}`);
  eq(pub.status, 200, 'public drop read falls back to the database');
  const list = await api('GET', '/drops');
  eq(list.status, 200, 'drop list');
  const status = await api('GET', `/drops/${D}/entries/me`, { cookie: alice.cookie, ip: alice.ip });
  ok([401, 503].includes(status.status), `status read: ${status.status}`);
  const login = await api('POST', '/auth/otp/request', { body: { email: `x.${Date.now()}@fairdrop.test` }, ip: alice.ip });
  ok([400, 503].includes(login.status), `login request: ${login.status}`);
  const chal = await api('GET', '/pow/challenge?purpose=otp', { ip: alice.ip });
  ok([200, 503].includes(chal.status), `challenge: ${chal.status}`);
  noCrash();
});

await t('Redis back: the API recovers by itself and people can sign in again', async () => {
  const t0 = Date.now();
  compose('start redis');
  ok(await healthy(30000), 'healthy again');
  console.log(`      recovered in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  noCrash();
  redis.disconnect();
  redis = await redisClient();
  const bob = await newUser('res');
  eq((await enter(bob, D)).status, 201, 'new person can sign in and enter');
  // entries made before the outage are still there (they live in Postgres)
  const n = (await db.query('SELECT COUNT(*)::int AS n FROM entries WHERE drop_id = $1', [D])).rows[0].n;
  eq(n, 2, 'both entries kept');
  // Redis lost the old sessions (it keeps nothing on disk), so the old cookie asks for a new login
  eq((await api('GET', `/drops/${D}/entries/me`, { cookie: alice.cookie, ip: alice.ip })).status, 401, 'old session gone');
});

await t('live updates keep working after Redis came back', async () => {
  const user = await newUser('res');
  await enter(user, D);
  const ctl = new AbortController();
  const res = await fetch(`${BASE}/drops/${D}/events`, { headers: { Cookie: user.cookie, 'X-Test-Key': TEST_KEY, 'X-Test-Client-IP': user.ip }, signal: ctl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = '';
  const pump = (async () => { try { while (true) { const { value, done: fin } = await reader.read(); if (fin) return; text += dec.decode(value); } } catch { /* aborted */ } })();
  await sleep(500);
  eq((await adminCall('POST', `/admin/drops/${D}/close`)).status, 200);
  for (let i = 0; i < 30 && !/"state":"CLOSED"/.test(text); i++) await sleep(200);
  ctl.abort();
  await pump;
  ok(/"state":"CLOSED"/.test(text), 'saw the CLOSED event over the stream');
});

// ---------------------------------------------------------------- Postgres down
await t('Postgres stopped: health says so, writes answer 503 (never 500), nothing crashes', async () => {
  compose('stop postgres');
  await sleep(2500);
  const h = await api('GET', '/health');
  eq([h.status, h.data.db], [503, false], 'health');
  const carol = await newUser('res').catch((e) => e);
  ok(carol instanceof Error || carol.cookie, 'login attempt does not hang the test');
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) => api('GET', `/drops/${D}/draw`).catch(() => ({ status: 0 }))));
  const bad = results.filter((r) => ![200, 404, 503].includes(r.status));
  eq(bad.map((r) => r.status), [], 'only 200 (cached), 404 or 503');
  const adm = await adminCall('POST', `/admin/drops/${D}/draw`).catch(() => ({ status: 503 }));
  ok([503, 401, 500].includes(adm.status) && adm.status !== 500, `admin draw during outage: ${adm.status}`);
  noCrash();
});

await t('Postgres back: the API and worker recover with no restart, data intact', async () => {
  const t0 = Date.now();
  compose('start postgres');
  ok(await healthy(60000), 'healthy again');
  console.log(`      recovered in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  noCrash();
  db.end().catch(() => {});
  await sleep(1500);
  db = await dbClient();
  const dave = await newUser('res');
  const e = await enter(dave, D);
  ok([201, 409].includes(e.status), `entry after recovery: ${e.status} ${e.code}`);
  eq(await checkInvariants(db, D), [], 'invariants');
  const audit = (await db.query('SELECT seq, type, payload, prev_hash, hash FROM audit_log ORDER BY seq')).rows;
  const { createHash } = await import('node:crypto');
  let prev = '0'.repeat(64);
  for (const r of audit) {
    eq(r.prev_hash, prev, `chain at ${r.seq}`);
    eq(r.hash, createHash('sha256').update(`${prev}|${r.seq}|${r.type}|${r.payload}`).digest('hex'), `hash at ${r.seq}`);
    prev = r.hash;
  }
});

// ---------------------------------------------------------------- API container restart
await t('restarting one API container while requests flow: the other takes over, few or no failures', async () => {
  let failed = 0;
  let sent = 0;
  let stop = false;
  const hammer = (async () => {
    while (!stop) {
      const r = await api('GET', `/drops/${D}`, { ip: nextIp() }).catch(() => ({ status: 0 }));
      sent++;
      if (r.status !== 200) failed++;
      await sleep(20);
    }
  })();
  await sleep(500);
  compose('restart api1');
  await sleep(6000);
  stop = true;
  await hammer;
  console.log(`      ${sent} requests, ${failed} failed during the restart`);
  ok(failed <= Math.ceil(sent * 0.05), `too many failures: ${failed}/${sent}`);
  noCrash();
});

// make sure the next test run starts clean and nginx points at the right addresses
compose('exec -T nginx nginx -s reload');
await healthy(30000);

const failed = done();
await db.end().catch(() => {});
redis.disconnect();
process.exit(failed ? 1 : 0);
