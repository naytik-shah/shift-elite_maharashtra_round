// Flash-crowd load test: N users sign in and enter, the organiser closes and draws, everyone reads
// their result at once, winners confirm. Checks correctness at the end, not just speed.
// The per-user work is spread over several worker threads so the generator is not the bottleneck.
//
//   USERS=50000 CONC=600 THREADS=4 TEST_KEY=... node load-test.mjs
//   scripts/run-in-docker.sh load-test.mjs      (runs it inside the Docker network of the stack)
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import {
  TEST_KEY, ORGANISER, sleep, sha256, rid, rankEntries, dbClient, redisClient, flushRedis, CACHE_PATTERNS, resetDrop,
} from './lib.mjs';
import { checkInvariants } from './invariants.mjs';
import { lat, codes, mergeSnapshot, call, nextBase, solve } from './load-core.mjs';

const N = Number(process.env.USERS || 5000);
const CONC = Number(process.env.CONC || 400);
const THREADS = Math.max(1, Number(process.env.THREADS || 4));
const SSE_USERS = Math.min(N, Number(process.env.SSE_USERS || 2000));
const DROP = process.env.DROP_ID || 'test-load';
const STATUS_CONC = Number(process.env.STATUS_CONC || 800);

if (!TEST_KEY) { console.error('Set TEST_KEY.'); process.exit(1); }

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const banner = (s) => console.log(`\n--- ${s}`);

// Runs a task over users, split across the worker threads; fills the results back into `users`.
async function sharded(task, users, conc, extra = {}) {
  const per = Math.ceil(users.length / THREADS);
  const slices = Array.from({ length: THREADS }, (_, i) => users.slice(i * per, (i + 1) * per)).filter((s) => s.length);
  const results = await Promise.all(slices.map((slice) => new Promise((resolve, reject) => {
    const w = new Worker(new URL('./load-worker.mjs', import.meta.url));
    w.once('message', (m) => { w.terminate(); m.ok ? resolve(m) : reject(new Error(m.error)); });
    w.once('error', reject);
    w.postMessage({ task, users: slice, conc: Math.max(1, Math.ceil(conc / slices.length)), drop: DROP, ...extra });
  })));
  const merged = { lat, codes };
  let k = 0;
  results.forEach((r, i) => {
    r.users.forEach((u, j) => { users[i * per + j] = u; k++; });
    mergeSnapshot(merged, r.snap);
  });
  return k;
}

// ---------------------------------------------------------------- setup
const db = await dbClient();
const redis = await redisClient();
await resetDrop(db, redis, DROP);
await flushRedis(redis, CACHE_PATTERNS);
const SEATS = (await db.query('SELECT seats FROM drops WHERE id = $1', [DROP])).rows[0].seats;
console.log(`Load test: ${N} users, ${CONC} in flight over ${THREADS} threads, drop "${DROP}" (${SEATS} seats)`);

// ---------------------------------------------------------------- phase 1: sign in and enter
banner('1. window opens: everyone signs in and enters');
const base0 = crypto.randomInt(0, 60000);
let users = Array.from({ length: N }, (_, i) => {
  const n = (base0 + i) % 65536;
  return { email: `ld.${rid()}.${i}@fairdrop.test`, ip: `10.${(n >> 8) & 255}.${n & 255}.9`, cookie: null, id: null, entered: false };
});
let t0 = performance.now();
await sharded('signup', users, CONC);
const phase1Sec = (performance.now() - t0) / 1000;
const entered = users.filter((u) => u.entered);
console.log(`   ${entered.length}/${N} entered in ${phase1Sec.toFixed(1)}s (${(N / phase1Sec).toFixed(0)} users/s, ${(([...lat.values()].reduce((a, b) => a + b.length, 0)) / phase1Sec).toFixed(0)} requests/s)`);

// ---------------------------------------------------------------- phase 2: live streams
banner(`2. ${SSE_USERS} users open live streams before the draw`);
const sseGot = new Map();
const sseConns = [];
let sseOpen = 0;
let drawStartedAt = 0;
async function openStream(u) {
  const ctl = new AbortController();
  try {
    const res = await fetch(nextBase() + `/drops/${DROP}/events`, {
      headers: { Cookie: u.cookie, 'X-Test-Key': TEST_KEY, 'X-Test-Client-IP': u.ip, Accept: 'text/event-stream' }, signal: ctl.signal,
    });
    if (res.status !== 200) return;
    sseOpen++;
    sseConns.push(ctl);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) return;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            if (block.startsWith('event: your_status')) {
              const d = JSON.parse(/data: (.+)/.exec(block)[1]);
              if (d.state === 'WON' || d.state === 'WAITLISTED') sseGot.set(u.id, { at: performance.now(), state: d.state });
            }
          }
        }
      } catch { /* closed */ }
    })();
  } catch { /* could not connect */ }
}
const sseUsers = entered.slice(0, SSE_USERS);
let si = 0;
await Promise.all(Array.from({ length: 100 }, async () => { while (si < sseUsers.length) await openStream(sseUsers[si++]); }));
console.log(`   ${sseOpen}/${SSE_USERS} streams open`);

// ---------------------------------------------------------------- phase 3: close and draw
banner('3. organiser closes entries and runs the draw');
const adminIp = '10.250.250.250';
const adminPow = await solve({ ip: adminIp }, 'otp');
const adminReq = await call('admin login', 'POST', '/auth/otp/request', { body: { email: ORGANISER, pow: adminPow }, ip: adminIp });
const adminVer = await call('admin login', 'POST', '/auth/otp/verify', { body: { email: ORGANISER, code: adminReq.data.devCode }, ip: adminIp });
const adminCookie = adminVer.cookie;
t0 = performance.now();
const closeRes = await call('close', 'POST', `/admin/drops/${DROP}/close`, { cookie: adminCookie, ip: adminIp, body: {} });
console.log(`   close: ${closeRes.status} in ${(performance.now() - t0).toFixed(0)} ms, ${closeRes.data?.entries} entries counted`);
t0 = performance.now();
drawStartedAt = t0;
const drawRes = await call('draw', 'POST', `/admin/drops/${DROP}/draw`, { cookie: adminCookie, ip: adminIp, body: {} });
console.log(`   draw: ${drawRes.status} in ${(performance.now() - t0).toFixed(0)} ms`);

await sleep(Math.min(15000, 3000 + SSE_USERS * 3));
const pushed = [...sseGot.values()];
const pushLat = pushed.map((p) => p.at - drawStartedAt);
console.log(`   live push: ${pushed.length}/${sseOpen} streams got their result; p50 ${pct(pushLat, 50).toFixed(0)} ms, p95 ${pct(pushLat, 95).toFixed(0)} ms, max ${Math.max(0, ...pushLat).toFixed(0)} ms`);
sseConns.forEach((c) => c.abort());

// ---------------------------------------------------------------- phase 4: result reveal burst
banner('4. reveal burst: everyone reads their own status at once');
const dd = (await call('draw info', 'GET', `/drops/${DROP}/draw`)).data;
const results = (await call('draw results', 'GET', `/drops/${DROP}/draw/results`)).data;
const manifest = (await call('draw manifest', 'GET', `/drops/${DROP}/draw/manifest`)).data;
const rankOf = new Map(results.ranking.map((id, i) => [id, i + 1]));
t0 = performance.now();
await sharded('status', users, STATUS_CONC);
const burstSec = (performance.now() - t0) / 1000;
let wrong = 0;
for (const u of users) {
  if (!u.entered) continue;
  const s = u.status;
  if (!s) { wrong++; continue; }
  const rank = rankOf.get(s.entryId);
  const expect = rank <= SEATS ? 'WON' : 'WAITLISTED';
  if (s.state !== expect || s.rank !== rank || (expect === 'WAITLISTED' && s.waitlistPosition !== rank - SEATS)) wrong++;
}
console.log(`   ${entered.length} status reads in ${burstSec.toFixed(1)}s (${(entered.length / burstSec).toFixed(0)} req/s), wrong answers: ${wrong}`);

// ---------------------------------------------------------------- phase 5: verify the draw independently
banner('5. verify the draw like a stranger would');
t0 = performance.now();
const manifestOk = sha256(JSON.stringify(manifest.entries)) === dd.manifestHash;
const seedOk = sha256(dd.seed) === dd.seedCommit;
const rerun = rankEntries(dd.seed, manifest.entries);
const sameRanking = rerun.length === results.ranking.length && rerun.every((id, i) => id === results.ranking[i]);
console.log(`   seed matches commit: ${seedOk}, manifest hash: ${manifestOk}, ranking identical: ${sameRanking} (${manifest.entries.length} entries, ${(performance.now() - t0).toFixed(0)} ms)`);

// ---------------------------------------------------------------- phase 6: confirm
banner('6. winners confirm (first with a shared pool of 20 cards, then with their own)');
const winners = users.filter((u) => u.status?.state === 'WON');
winners.forEach((u, i) => { u.winnerNo = i; });
const cards = Array.from({ length: 20 }, () => `shared-${rid()}`);
t0 = performance.now();
await sharded('confirm-shared', winners, 250, { cards });
const ok1 = winners.filter((u) => u.confirmStatus === 200).length;
const blocked1 = winners.filter((u) => u.confirmCode === 'ANCHOR_ALREADY_USED').length;
console.log(`   shared cards: ${ok1} confirmed, ${blocked1} blocked, ${winners.length - ok1 - blocked1} other (expected exactly ${Math.min(20, winners.length)} confirmed)`);
const rest = winners.filter((u) => u.confirmStatus !== 200);
await sharded('confirm-own', rest, 250);
const ok2 = rest.filter((u) => u.confirmStatus === 200).length;
console.log(`   own cards: ${ok2}/${rest.length} confirmed; all confirms took ${((performance.now() - t0) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------- phase 7: invariants
banner('7. database checks');
const bad = await checkInvariants(db, DROP);
const counts = (await db.query('SELECT state, COUNT(*)::int AS n FROM entries WHERE drop_id = $1 GROUP BY 1 ORDER BY 1', [DROP])).rows;
console.log(`   entry states: ${counts.map((c) => `${c.state} ${c.n}`).join(', ')}`);
console.log(`   invariant violations: ${bad.length ? bad.join('; ') : 'none'}`);

// ---------------------------------------------------------------- report
banner('latency by request type (ms)');
console.log('   ' + 'request'.padEnd(26) + 'count'.padStart(8) + 'p50'.padStart(8) + 'p95'.padStart(8) + 'p99'.padStart(8) + 'max'.padStart(8) + '   outcomes');
for (const [label, arr] of lat) {
  const outcomes = Object.entries(codes.get(label)).map(([k, v]) => `${k}x${v}`).join(' ');
  console.log('   ' + label.padEnd(26) + String(arr.length).padStart(8) + pct(arr, 50).toFixed(0).padStart(8) + pct(arr, 95).toFixed(0).padStart(8) + pct(arr, 99).toFixed(0).padStart(8) + Math.max(...arr).toFixed(0).padStart(8) + '   ' + outcomes);
}
let fiveXX = 0;
for (const c of codes.values()) for (const [k, v] of Object.entries(c)) if (/^5\d\d|^NETWORK/.test(k)) fiveXX += v;
const total = [...lat.values()].reduce((a, b) => a + b.length, 0);
console.log(`\n   total requests ${total}, server errors/network failures ${fiveXX} (${((fiveXX / total) * 100).toFixed(2)}%)`);

const problems = [];
if (entered.length !== N) problems.push(`only ${entered.length}/${N} users entered`);
if (wrong) problems.push(`${wrong} users saw a wrong or missing status`);
if (!seedOk || !manifestOk || !sameRanking) problems.push('the draw could not be reproduced');
if (ok1 !== Math.min(20, winners.length)) problems.push('shared card pool let through the wrong number of seats');
if (ok1 + ok2 !== winners.length) problems.push(`${winners.length - ok1 - ok2} winners could not confirm`);
if (bad.length) problems.push(...bad);
console.log(problems.length ? `\nFAILED:\n - ${problems.join('\n - ')}` : '\nALL CHECKS PASSED');

await db.end();
redis.disconnect();
process.exit(problems.length ? 1 : 0);
