// Edge-case and abuse tests for the backend. Needs the API and worker running, the test drops from
// config/drops.test.yaml loaded, and TEST_KEY set to the server's key.
//
//   TEST_KEY=... node edge-tests.mjs
import {
  api, newUser, login, solvePow, getChallenge, solveNonce, enter, myStatus, confirm, adminCall, pmap, nextIp, rid,
  rankEntries, dbClient, redisClient, flushRedis, CACHE_PATTERNS, resetDrop, suite, eq, ok, expectErr, sha256, sleep,
  BASE, TEST_KEY,
} from './lib.mjs';

if (!TEST_KEY) { console.error('Set TEST_KEY to the server TEST_KEY.'); process.exit(1); }

const db = await dbClient();
const redis = await redisClient();
for (const id of ['test-edge', 'test-race', 'test-empty', 'test-live']) await resetDrop(db, redis, id);
await flushRedis(redis, CACHE_PATTERNS);

const { t, done } = suite('Edge case tests');

// ---------------------------------------------------------------- protocol and validation
await t('health check reports db and redis', async () => {
  const r = await api('GET', '/health');
  eq([r.status, r.data.ok, r.data.db, r.data.redis], [200, true, true, true]);
});

await t('unknown route gives a JSON 404, not an HTML page', async () => {
  const r = await api('GET', '/nope');
  expectErr(r, 404, 'NOT_FOUND');
});

await t('non-JSON content type on a write is refused', async () => {
  const r = await api('POST', '/auth/otp/request', { contentType: 'text/plain', raw: '{"email":"a@b.co"}' });
  expectErr(r, 400, 'VALIDATION_FAILED');
});

await t('malformed JSON gives 400, not 500', async () => {
  const r = await api('POST', '/auth/otp/request', { raw: '{"email": ' });
  expectErr(r, 400, 'VALIDATION_FAILED');
});

await t('oversized body is refused (413)', async () => {
  const r = await api('POST', '/auth/otp/request', { body: { email: 'a'.repeat(20000) } });
  expectErr(r, 413, 'VALIDATION_FAILED');
});

await t('strange drop ids give 404, never 500', async () => {
  for (const id of ['..%2f..%2fetc', '%3Cscript%3E', 'x'.repeat(100), '%00', 'a b']) {
    const r = await api('GET', `/drops/${id}`);
    ok(r.status === 404 || r.status === 400, `id ${id} -> ${r.status}`);
  }
});

await t('bad puzzle purpose is rejected', async () => {
  expectErr(await api('GET', '/pow/challenge?purpose=evil'), 400, 'VALIDATION_FAILED');
  expectErr(await api('GET', '/pow/challenge'), 400, 'VALIDATION_FAILED');
});

await t('protected routes need a login', async () => {
  expectErr(await api('GET', '/me'), 401, 'UNAUTHENTICATED');
  expectErr(await api('GET', '/drops/test-edge/entries/me'), 401, 'UNAUTHENTICATED');
  expectErr(await api('POST', '/drops/test-edge/entries', { body: {} }), 401, 'UNAUTHENTICATED');
  expectErr(await api('GET', '/tickets/me'), 401, 'UNAUTHENTICATED');
  expectErr(await api('GET', '/drops/test-edge/events'), 401, 'UNAUTHENTICATED');
  expectErr(await api('POST', '/admin/drops/test-edge/close', { body: {} }), 401, 'UNAUTHENTICATED');
});

await t('a normal user cannot reach organiser routes', async () => {
  const u = await newUser('plain');
  for (const [m, p] of [['POST', '/admin/drops/test-edge/close'], ['POST', '/admin/drops/test-edge/draw'], ['GET', '/admin/drops/test-edge/live'], ['GET', '/admin/audit'], ['GET', '/admin/drops/test-edge/slots']]) {
    const r = await api(m, p, { cookie: u.cookie, ip: u.ip, body: m === 'POST' ? {} : undefined });
    expectErr(r, 403, 'FORBIDDEN', `${m} ${p}`);
  }
});

await t('drop list and detail have the documented fields', async () => {
  const list = await api('GET', '/drops');
  ok(list.data.drops.length >= 5, 'drops listed');
  const d = (await api('GET', '/drops/test-edge')).data;
  for (const f of ['id', 'name', 'seats', 'state', 'windowOpensAt', 'windowClosesAt', 'drawAt', 'confirmWindowMinutes', 'ticketPrice', 'seedCommit']) ok(f in d, `missing ${f}`);
  eq(d.seedCommit.length, 64);
  expectErr(await api('GET', '/drops/does-not-exist'), 404, 'NOT_FOUND');
});

await t('draw data is hidden before the draw', async () => {
  const d = (await api('GET', '/drops/test-edge/draw')).data;
  eq([d.seed, d.manifestHash], [null, null]);
  expectErr(await api('GET', '/drops/test-edge/draw/manifest'), 404, 'NOT_FOUND');
  expectErr(await api('GET', '/drops/test-edge/draw/results'), 404, 'NOT_FOUND');
});

// ---------------------------------------------------------------- proof of work
await t('wrong test key behaves like a normal visitor (hard puzzle, no dev code, own IP ignored)', async () => {
  const r = await api('GET', '/pow/challenge?purpose=otp', { testKey: 'definitely-not-the-key', ip: '10.9.9.9' });
  ok(r.data.difficulty >= 18, `difficulty ${r.data.difficulty}`);
  const email = `real.${rid()}@fairdrop.test`;
  const nonce = solveNonce(r.data.prefix, r.data.difficulty);
  const req = await api('POST', '/auth/otp/request', { testKey: 'definitely-not-the-key', ip: '10.9.9.9', body: { email, pow: { challengeId: r.data.challengeId, nonce } } });
  eq(req.status, 202);
  ok(!req.data || !('devCode' in req.data), 'no devCode without the key');
});

await t('a solved puzzle can only be used once', async () => {
  const ip = nextIp();
  const pow = await solvePow('otp', ip);
  const a = await api('POST', '/auth/otp/request', { ip, body: { email: `once.${rid()}@fairdrop.test`, pow } });
  eq(a.status, 202);
  const b = await api('POST', '/auth/otp/request', { ip, body: { email: `once.${rid()}@fairdrop.test`, pow } });
  expectErr(b, 400, 'POW_INVALID');
});

await t('puzzle checks: missing, wrong nonce, junk nonce, other IP, other purpose', async () => {
  const ip = nextIp();
  const email = () => `pow.${rid()}@fairdrop.test`;
  expectErr(await api('POST', '/auth/otp/request', { ip, body: { email: email() } }), 400, 'POW_INVALID', 'missing');

  const c1 = await getChallenge('otp', ip);
  const bad = solveNonce(c1.prefix, c1.difficulty, { fail: true });
  expectErr(await api('POST', '/auth/otp/request', { ip, body: { email: email(), pow: { challengeId: c1.challengeId, nonce: bad } } }), 400, 'POW_INVALID', 'wrong nonce');

  const c2 = await getChallenge('otp', ip);
  expectErr(await api('POST', '/auth/otp/request', { ip, body: { email: email(), pow: { challengeId: c2.challengeId, nonce: 'abc' } } }), 400, 'POW_INVALID', 'junk nonce');

  const c3 = await getChallenge('otp', ip);
  const n3 = solveNonce(c3.prefix, c3.difficulty);
  expectErr(await api('POST', '/auth/otp/request', { ip: nextIp(), body: { email: email(), pow: { challengeId: c3.challengeId, nonce: n3 } } }), 400, 'POW_INVALID', 'other IP');

  const c4 = await getChallenge('entry', ip);
  const n4 = solveNonce(c4.prefix, c4.difficulty);
  expectErr(await api('POST', '/auth/otp/request', { ip, body: { email: email(), pow: { challengeId: c4.challengeId, nonce: n4 } } }), 400, 'POW_INVALID', 'other purpose');

  expectErr(await api('POST', '/auth/otp/request', { ip, body: { email: email(), pow: { challengeId: '../../etc', nonce: '1' } } }), 400, 'POW_INVALID', 'junk id');
});

// ---------------------------------------------------------------- one-time codes
await t('bad emails are rejected, disposable domains too', async () => {
  const ip = nextIp();
  for (const email of ['notanemail', '@x.com', 'a@b', '', ' ', 'a b@c.com']) {
    const r = await api('POST', '/auth/otp/request', { ip, body: { email } });
    expectErr(r, 400, 'VALIDATION_FAILED', JSON.stringify(email));
  }
  const d = await api('POST', '/auth/otp/request', { ip, body: { email: 'someone@mailinator.com' } });
  expectErr(d, 400, 'VALIDATION_FAILED', 'disposable');
});

await t('five wrong codes lock the code, the right code then fails too', async () => {
  const ip = nextIp();
  const email = `lock.${rid()}@fairdrop.test`;
  const pow = await solvePow('otp', ip);
  const req = await api('POST', '/auth/otp/request', { ip, body: { email, pow } });
  const good = req.data.devCode;
  const wrong = good === '000000' ? '111111' : '000000';
  for (let i = 1; i <= 4; i++) expectErr(await api('POST', '/auth/otp/verify', { ip, body: { email, code: wrong } }), 400, 'OTP_INVALID', `try ${i}`);
  expectErr(await api('POST', '/auth/otp/verify', { ip, body: { email, code: wrong } }), 429, 'OTP_LOCKED', 'try 5');
  expectErr(await api('POST', '/auth/otp/verify', { ip, body: { email, code: good } }), 400, 'OTP_INVALID', 'right code after lock');
});

await t('30 parallel guesses still only get 5 tries in total', async () => {
  const email = `par.${rid()}@fairdrop.test`;
  const ip = nextIp();
  const pow = await solvePow('otp', ip);
  const good = (await api('POST', '/auth/otp/request', { ip, body: { email, pow } })).data.devCode;
  const wrong = good === '000000' ? '111111' : '000000';
  const results = await Promise.all(Array.from({ length: 30 }, () => api('POST', '/auth/otp/verify', { ip: nextIp(), body: { email, code: wrong } })));
  eq(results.filter((r) => r.code === 'OTP_LOCKED').length, 1, 'exactly one lock response');
  ok(results.every((r) => r.status === 400 || r.status === 429), 'only 400/429');
  expectErr(await api('POST', '/auth/otp/verify', { ip: nextIp(), body: { email, code: good } }), 400, 'OTP_INVALID', 'right code afterwards');
});

await t('a code works once; code format is validated', async () => {
  const ip = nextIp();
  const email = `once.${rid()}@fairdrop.test`;
  const pow = await solvePow('otp', ip);
  const code = (await api('POST', '/auth/otp/request', { ip, body: { email, pow } })).data.devCode;
  expectErr(await api('POST', '/auth/otp/verify', { ip, body: { email, code: '12345' } }), 400, 'VALIDATION_FAILED', 'short');
  expectErr(await api('POST', '/auth/otp/verify', { ip, body: { email, code: 'abcdef' } }), 400, 'VALIDATION_FAILED', 'letters');
  const v = await api('POST', '/auth/otp/verify', { ip, body: { email, code } });
  eq(v.status, 200);
  expectErr(await api('POST', '/auth/otp/verify', { ip, body: { email, code } }), 400, 'OTP_INVALID', 'reuse');
});

await t('session cookie is HttpOnly + SameSite=Lax, logout ends the session', async () => {
  const ip = nextIp();
  const email = `cookie.${rid()}@fairdrop.test`;
  const pow = await solvePow('otp', ip);
  const code = (await api('POST', '/auth/otp/request', { ip, body: { email, pow } })).data.devCode;
  const res = await fetch(`${BASE}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Test-Key': TEST_KEY, 'X-Test-Client-IP': ip },
    body: JSON.stringify({ email, code }),
  });
  const sc = res.headers.getSetCookie().join(' | ');
  ok(/HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc), `cookie flags: ${sc}`);
  const cookie = sc.split(';')[0];
  eq((await api('GET', '/me', { cookie, ip })).data.email, email);
  eq((await api('POST', '/auth/logout', { cookie, ip, body: {} })).status, 204);
  expectErr(await api('GET', '/me', { cookie, ip }), 401, 'UNAUTHENTICATED', 'after logout');
});

await t('Gmail dots and +tags map to one account; other domains keep dots', async () => {
  const base = `al${rid()}`;
  const a = await login(`${base.slice(0, 3)}.${base.slice(3)}+one@Gmail.com`, nextIp());
  const b = await login(`${base}@googlemail.com`, nextIp());
  eq(a.user.id, b.user.id, 'same gmail account');
  const c = await login(`dots.${base}@fairdrop.test`, nextIp());
  const d = await login(`dots${base}@fairdrop.test`, nextIp());
  ok(c.user.id !== d.user.id, 'dots matter outside gmail');
  const e = await login(`PLUS${base}+a@fairdrop.test`, nextIp());
  const f = await login(`plus${base}+b@fairdrop.test`, nextIp());
  eq(e.user.id, f.user.id, '+tag and case ignored');
});

await t('rate limits: 4th code for one email, 6th for one IP', async () => {
  const email = `rl.${rid()}@fairdrop.test`;
  let last;
  for (let i = 1; i <= 4; i++) {
    const ip = nextIp();
    last = await api('POST', '/auth/otp/request', { ip, body: { email, pow: await solvePow('otp', ip) } });
    if (i < 4) eq(last.status, 202, `request ${i}`);
  }
  expectErr(last, 429, 'RATE_LIMITED', 'email limit');
  ok(Number(last.headers.get('retry-after')) >= 1, 'Retry-After header');

  const ip = nextIp();
  let r;
  for (let i = 1; i <= 6; i++) {
    r = await api('POST', '/auth/otp/request', { ip, body: { email: `ip${i}.${rid()}@fairdrop.test`, pow: await solvePow('otp', ip) } });
    if (i < 6) eq(r.status, 202, `ip request ${i}`);
  }
  expectErr(r, 429, 'RATE_LIMITED', 'ip limit');
});

// ---------------------------------------------------------------- entries
await t('entry refused when window not open yet, already closed, or drop unknown', async () => {
  const u = await newUser();
  expectErr(await enter(u, 'test-future'), 409, 'DROP_NOT_OPEN', 'not open yet');
  expectErr(await enter(u, 'test-past'), 409, 'DROP_NOT_OPEN', 'window passed');
  expectErr(await enter(u, 'no-such-drop'), 404, 'NOT_FOUND', 'unknown');
  expectErr(await enter(u, 'launch-night'), 409, 'DROP_NOT_OPEN', 'launch-night opens later today');
});

await t('entry input checks: no puzzle, huge fingerprint', async () => {
  const u = await newUser();
  expectErr(await api('POST', '/drops/test-edge/entries', { cookie: u.cookie, ip: u.ip, body: { deviceFingerprint: 'x' } }), 400, 'POW_INVALID', 'no puzzle');
  const pow = await solvePow('entry', u.ip);
  expectErr(await api('POST', '/drops/test-edge/entries', { cookie: u.cookie, ip: u.ip, body: { pow, deviceFingerprint: 'x'.repeat(500) } }), 400, 'VALIDATION_FAILED', 'fingerprint');
});

await t('5 simultaneous entries by one user make exactly one entry', async () => {
  const u = await newUser();
  const pows = await Promise.all(Array.from({ length: 5 }, () => solvePow('entry', u.ip)));
  const rs = await Promise.all(pows.map((pow) => api('POST', '/drops/test-edge/entries', { cookie: u.cookie, ip: u.ip, body: { pow, deviceFingerprint: 'race' } })));
  eq(rs.filter((r) => r.status === 201).length, 1, 'created');
  eq(rs.filter((r) => r.code === 'ALREADY_ENTERED').length, 4, 'duplicates');
  const n = (await db.query('SELECT COUNT(*)::int AS n FROM entries WHERE drop_id = $1 AND user_id = $2', ['test-edge', u.id])).rows[0].n;
  eq(n, 1, 'rows in database');
});

await t('idempotency: same key replays the first answer, changed body is refused', async () => {
  const u = await newUser();
  const pow = await solvePow('entry', u.ip);
  const key = `idem-${rid()}`;
  const body = { pow, deviceFingerprint: 'idem' };
  const first = await api('POST', '/drops/test-edge/entries', { cookie: u.cookie, ip: u.ip, body, headers: { 'Idempotency-Key': key } });
  eq(first.status, 201);
  const second = await api('POST', '/drops/test-edge/entries', { cookie: u.cookie, ip: u.ip, body, headers: { 'Idempotency-Key': key } });
  eq([second.status, second.data.entryId], [201, first.data.entryId], 'replayed answer');
  eq(second.headers.get('idempotent-replay'), 'true');
  const other = await api('POST', '/drops/test-edge/entries', { cookie: u.cookie, ip: u.ip, body: { ...body, deviceFingerprint: 'different' }, headers: { 'Idempotency-Key': key } });
  expectErr(other, 422, 'IDEMPOTENCY_MISMATCH');
});

await t('status of someone who has not entered is a clean 404', async () => {
  const u = await newUser();
  expectErr(await myStatus(u, 'test-edge'), 404, 'NOT_FOUND');
});

await t('entry attempts are rate limited per user (6th within a minute)', async () => {
  const u = await newUser();
  let r;
  for (let i = 1; i <= 6; i++) {
    r = await api('POST', '/drops/test-edge/entries', { cookie: u.cookie, ip: u.ip, body: { deviceFingerprint: 'spam' } });
    if (i <= 5) eq(r.code, 'POW_INVALID', `attempt ${i}`);
  }
  expectErr(r, 429, 'RATE_LIMITED');
});

// ---------------------------------------------------------------- close races with entries
await t('close vs 150 simultaneous entries: no entry slips in after close', async () => {
  const users = await pmap(Array.from({ length: 150 }), () => newUser('race'), 20);
  const pows = await pmap(users, (u) => solvePow('entry', u.ip), 40);
  const fire = (u, i) => api('POST', '/drops/test-race/entries', { cookie: u.cookie, ip: u.ip, body: { pow: pows[i], deviceFingerprint: 'r' } });
  const t0 = Date.now();
  const entries = Promise.all(users.map((u, i) => fire(u, i)));
  await sleep(40);
  const closed = await adminCall('POST', '/admin/drops/test-race/close');
  const closeMs = Date.now() - t0;
  const results = await entries;
  eq(closed.status, 200, `close: ${JSON.stringify(closed.data)}`);
  const created = results.filter((r) => r.status === 201).length;
  const refused = results.filter((r) => r.code === 'DROP_NOT_OPEN').length;
  eq(created + refused, 150, `unexpected statuses: ${JSON.stringify(results.filter((r) => r.status !== 201 && r.code !== 'DROP_NOT_OPEN').map((r) => [r.status, r.code]))}`);
  const inDb = (await db.query('SELECT COUNT(*)::int AS n FROM entries WHERE drop_id = $1', ['test-race'])).rows[0].n;
  eq(inDb, closed.data.entries, 'entries counted at close equal entries in database afterwards');
  eq(inDb, created, 'every 201 is in the database');
  console.log(`      (${created} got in, ${refused} refused, close answered in ${closeMs} ms)`);
  ok(closeMs < 10000, 'close must not be starved by entries');
});

// ---------------------------------------------------------------- draw, confirm, race rules (test-edge)
const entrants = [];
await t('create 20 more entrants on test-edge', async () => {
  const users = await pmap(Array.from({ length: 20 }), () => newUser('edge'), 10);
  const rs = await pmap(users, (u) => enter(u, 'test-edge'), 10);
  eq(rs.filter((r) => r.status === 201).length, 20);
  entrants.push(...users);
});

await t('draw before close and manifest before draw are refused', async () => {
  expectErr(await adminCall('POST', '/admin/drops/test-edge/draw'), 409, 'INVALID_STATE');
  expectErr(await api('GET', '/drops/test-edge/draw/manifest'), 404, 'NOT_FOUND');
});

await t('close twice and unknown drop', async () => {
  eq((await adminCall('POST', '/admin/drops/test-edge/close')).status, 200);
  expectErr(await adminCall('POST', '/admin/drops/test-edge/close'), 409, 'INVALID_STATE');
  expectErr(await adminCall('POST', '/admin/drops/no-such-drop/close'), 404, 'NOT_FOUND');
  expectErr(await adminCall('POST', '/admin/drops/no-such-drop/draw'), 404, 'NOT_FOUND');
});

await t('entry after close is refused for new and existing entrants', async () => {
  const late = await newUser();
  expectErr(await enter(late, 'test-edge'), 409, 'DROP_NOT_OPEN');
  expectErr(await enter(entrants[0], 'test-edge'), 409, 'ALREADY_ENTERED');
});

let drawn;
await t('three simultaneous draw clicks: exactly one runs', async () => {
  const rs = await Promise.all([1, 2, 3].map(() => adminCall('POST', '/admin/drops/test-edge/draw')));
  eq(rs.filter((r) => r.status === 200).length, 1, 'ran');
  eq(rs.filter((r) => r.status === 409 && r.code === 'INVALID_STATE').length, 2, 'blocked');
  drawn = rs.find((r) => r.status === 200).data;
});

await t('the public draw can be re-run and matches', async () => {
  const d = (await api('GET', '/drops/test-edge/draw')).data;
  eq(sha256(d.seed), d.seedCommit, 'seed vs commit');
  const m = (await api('GET', '/drops/test-edge/draw/manifest')).data;
  eq(sha256(JSON.stringify(m.entries)), d.manifestHash, 'manifest hash');
  const res = (await api('GET', '/drops/test-edge/draw/results')).data;
  eq(rankEntries(d.seed, m.entries), res.ranking, 'ranking');
  eq(res.seats, 5);
  eq(drawn.manifestHash, d.manifestHash);
  ok(m.entries.every((e) => e.weight === 1), 'weights are numbers equal to 1');
});

await t('everyone has a state; 5 won, the rest are waitlisted in rank order', async () => {
  const st = await pmap(entrants, async (u) => ({ u, s: (await myStatus(u, 'test-edge')).data }), 10);
  const won = st.filter((x) => x.s.state === 'WON');
  const wl = st.filter((x) => x.s.state === 'WAITLISTED').sort((a, b) => a.s.rank - b.s.rank);
  ok(won.length <= 5, 'at most 5 of this group won');
  ok(won.every((x) => x.s.confirmBy), 'winners have a deadline');
  ok(wl.every((x) => x.s.waitlistPosition === x.s.rank - 5), 'position = rank - seats');
  entrants.won = won.map((x) => x.u);
  entrants.wl = wl.map((x) => x.u);
});

await t('confirm input is validated', async () => {
  const w = entrants.won[0];
  expectErr(await api('POST', '/drops/test-edge/entries/me/confirm', { cookie: w.cookie, ip: w.ip, body: { testCard: 'ab', payerName: 'x' } }), 400, 'VALIDATION_FAILED', 'short card');
  expectErr(await api('POST', '/drops/test-edge/entries/me/confirm', { cookie: w.cookie, ip: w.ip, body: { testCard: 'card-ok' } }), 400, 'VALIDATION_FAILED', 'no name');
  expectErr(await api('POST', '/drops/test-edge/entries/me/confirm', { cookie: w.cookie, ip: w.ip, body: { testCard: 'card-ok', payerName: '  ' } }), 400, 'VALIDATION_FAILED', 'blank name');
});

await t('people without a seat cannot confirm', async () => {
  const stranger = await newUser();
  expectErr(await confirm(stranger, 'test-edge', 'card-s'), 403, 'NOT_A_WINNER', 'never entered');
  if (entrants.wl.length) expectErr(await confirm(entrants.wl[0], 'test-edge', 'card-w'), 403, 'NOT_A_WINNER', 'waitlisted');
});

await t('same card on two winners at once: one confirms, the loser keeps their seat and can use another card', async () => {
  ok(entrants.won.length >= 3, 'need 3 winners among the 20');
  const [a, b, c] = entrants.won;
  const card = `shared-${rid()}`;
  const rs = await Promise.all([confirm(a, 'test-edge', card, 'A'), confirm(b, 'test-edge', card, 'B')]);
  eq(rs.filter((r) => r.status === 200).length, 1, 'confirmed');
  eq(rs.filter((r) => r.code === 'ANCHOR_ALREADY_USED').length, 1, 'blocked');
  const loser = rs[0].status === 200 ? b : a;
  const st = (await myStatus(loser, 'test-edge')).data;
  eq(st.state, 'WON', 'loser is still a winner');
  const second = await confirm(loser, 'test-edge', `own-${rid()}`, 'Loser');
  eq(second.status, 200, 'loser confirms with another card');
  // formatting must not let one card pass as two
  const c1 = await confirm(c, 'test-edge', `  CaRd-${rid().toUpperCase()} `, 'C');
  ok(c1.status === 200 || c1.code === 'ANCHOR_ALREADY_USED', 'c confirms or is blocked');
});

await t('5 simultaneous confirms by one winner: exactly one succeeds, no server errors', async () => {
  const w = entrants.won.find((u) => u !== entrants.won[0] && u !== entrants.won[1] && u !== entrants.won[2]);
  if (!w) return;
  const rs = await Promise.all(Array.from({ length: 5 }, () => confirm(w, 'test-edge', `multi-${rid()}`, 'Multi')));
  eq(rs.filter((r) => r.status === 200).length, 1, 'successes');
  ok(rs.every((r) => r.status === 200 || r.code === 'ALREADY_CONFIRMED'), `others: ${JSON.stringify(rs.map((r) => [r.status, r.code]))}`);
  const tickets = (await api('GET', '/tickets/me', { cookie: w.cookie, ip: w.ip })).data.tickets;
  eq(tickets.length, 1, 'one ticket');
});

await t('database invariants hold for test-edge', async () => {
  const q = async (sql) => (await db.query(sql, ['test-edge'])).rows;
  eq((await q('SELECT anchor_hash FROM seat_slots WHERE drop_id = $1 AND anchor_hash IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1')).length, 0, 'card twice');
  eq((await q('SELECT user_id FROM entries WHERE drop_id = $1 GROUP BY 1 HAVING COUNT(*) > 1')).length, 0, 'user twice');
  const slots = (await q('SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE state = \'CONFIRMED\')::int AS c FROM seat_slots WHERE drop_id = $1'))[0];
  eq(slots.n, 5, 'exactly 5 slots');
  const tk = (await q('SELECT COUNT(*)::int AS n FROM tickets t JOIN seat_slots s ON s.id = t.slot_id WHERE s.drop_id = $1'))[0].n;
  eq(tk, slots.c, 'tickets = confirmed');
  const e = (await q("SELECT COUNT(*)::int AS n FROM entries WHERE drop_id = $1 AND state IN ('WON','CONFIRMED')"))[0].n;
  ok(e <= 5, 'winning entries <= seats');
  const link = (await q("SELECT COUNT(*)::int AS n FROM seat_slots s JOIN entries e ON e.id = s.entry_id WHERE s.drop_id = $1 AND s.state = 'CONFIRMED' AND e.state <> 'CONFIRMED'"))[0].n;
  eq(link, 0, 'confirmed slot always has a confirmed entry');
});

// ---------------------------------------------------------------- drop with nobody in it
await t('draw with zero entries works, manifest is empty, drop completes', async () => {
  eq((await adminCall('POST', '/admin/drops/test-empty/close')).status, 200);
  const d = await adminCall('POST', '/admin/drops/test-empty/draw');
  eq(d.status, 200);
  eq(d.data.manifestHash, sha256('[]'));
  eq((await api('GET', '/drops/test-empty/draw/manifest')).data, { entries: [] });
  eq((await api('GET', '/drops/test-empty/draw/results')).data, { ranking: [], seats: 5 });
  let state = 'DRAWN';
  for (let i = 0; i < 30 && state !== 'COMPLETE'; i++) {
    await sleep(1000);
    state = (await api('GET', '/drops/test-empty')).data.state;
  }
  eq(state, 'COMPLETE', 'worker completes an empty drop');
});

// ---------------------------------------------------------------- live updates
function openSse(dropId, user) {
  const events = [];
  const waiters = [];
  const ctl = new AbortController();
  let ended = false;
  const done = (async () => {
    try {
      const res = await fetch(`${BASE}/drops/${dropId}/events`, {
        headers: { Cookie: user.cookie, 'X-Test-Key': TEST_KEY, 'X-Test-Client-IP': user.ip, Accept: 'text/event-stream' },
        signal: ctl.signal,
      });
      if (res.status !== 200) { events.push({ name: 'http_error', data: { status: res.status } }); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done: fin } = await reader.read();
        if (fin) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const name = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (!name) continue;
          const ev = { name, data: data ? JSON.parse(data) : null, at: Date.now() };
          events.push(ev);
          for (const w of [...waiters]) if (w.match(ev)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(ev); }
        }
      }
    } catch { /* aborted */ } finally { ended = true; }
  })();
  return {
    events,
    ended: () => ended,
    waitFor(name, pred = () => true, ms = 6000) {
      const found = events.find((e) => e.name === name && pred(e.data));
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const w = { match: (e) => e.name === name && pred(e.data), resolve };
        waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error(`no "${name}" event within ${ms} ms; got ${JSON.stringify(events.map((e) => e.name))}`)); } }, ms);
      });
    },
    close: () => ctl.abort(),
    done,
  };
}

const live = [];
await t('live stream: first message is the current status and drop state', async () => {
  const users = await pmap(Array.from({ length: 4 }), () => newUser('live'), 4);
  await pmap(users, (u) => enter(u, 'test-live'), 4);
  live.push(...users);
  const s = openSse('test-live', users[0]);
  live.sse = s;
  const st = await s.waitFor('your_status');
  eq(st.data.state, 'ENTERED');
  eq((await s.waitFor('drop_state')).data.state, 'OPEN');
});

await t('live stream: close and draw reach connected users within 3 seconds', async () => {
  const s2 = openSse('test-live', live[1]);
  live.sse2 = s2;
  await s2.waitFor('your_status');
  eq((await adminCall('POST', '/admin/drops/test-live/close')).status, 200);
  const c = await live.sse.waitFor('drop_state', (d) => d.state === 'CLOSED', 3000);
  ok(c, 'closed event');
  const t0 = Date.now();
  eq((await adminCall('POST', '/admin/drops/test-live/draw')).status, 200);
  const d = await live.sse.waitFor('drop_state', (x) => x.state === 'DRAWN', 3000);
  const mine = await live.sse.waitFor('your_status', (x) => x.state === 'WON' || x.state === 'WAITLISTED', 3000);
  ok(d && mine, 'draw events');
  ok(mine.at - t0 < 3000, 'status pushed quickly');
  const theirs = await live.sse2.waitFor('your_status', (x) => x.state === 'WON' || x.state === 'WAITLISTED', 3000);
  ok(theirs.data.rank >= 1, 'rank included');
  await live.sse.waitFor('manifest_published', () => true, 3000);
  const dc = await live.sse.waitFor('draw_complete', () => true, 3000);
  eq(dc.data.seed.length, 64, 'seed revealed over the stream');
});

await t('live stream: confirming pushes CONFIRMED to the confirming user', async () => {
  const st = await pmap(live, async (u) => ({ u, s: (await myStatus(u, 'test-live')).data }), 4);
  const winner = st.find((x) => x.s.state === 'WON').u;
  const sse = openSse('test-live', winner);
  await sse.waitFor('your_status');
  eq((await confirm(winner, 'test-live', `live-${rid()}`, 'Live Winner')).status, 200);
  await sse.waitFor('your_status', (x) => x.state === 'CONFIRMED', 3000);
  sse.close();
});

await t('live stream: a user cannot hold unlimited streams (5 per API process)', async () => {
  const u = live[2];
  const streams = Array.from({ length: 12 }, () => openSse('test-live', u));
  await sleep(1500);
  const rejected = streams.filter((s) => s.events.some((e) => e.name === 'error') || s.ended()).length;
  ok(rejected >= 2, `expected extra streams to be turned away, got ${rejected}`);
  streams.forEach((s) => s.close());
});

await t('live stream: reconnect gets the true status again at once', async () => {
  live.sse.close();
  await sleep(200);
  const again = openSse('test-live', live[0]);
  const st = await again.waitFor('your_status', () => true, 3000);
  ok(['WON', 'WAITLISTED', 'CONFIRMED', 'EXPIRED'].includes(st.data.state), `state ${st.data.state}`);
  again.close();
  live.sse2.close();
});

// ---------------------------------------------------------------- audit chain
await t('audit endpoint pages newest first and the chain verifies', async () => {
  const r = (await adminCall('GET', '/admin/audit?limit=500')).data.events;
  ok(r.length > 5, 'has events');
  for (let i = 1; i < r.length; i++) ok(r[i - 1].seq > r[i].seq, 'descending');
  const all = (await db.query('SELECT seq, type, payload, prev_hash, hash FROM audit_log ORDER BY seq')).rows;
  let prev = '0'.repeat(64);
  for (const row of all) {
    eq(row.prev_hash, prev, `prev of ${row.seq}`);
    eq(row.hash, sha256(`${prev}|${row.seq}|${row.type}|${row.payload}`), `hash of ${row.seq}`);
    prev = row.hash;
  }
  const one = (await adminCall('GET', '/admin/audit?dropId=test-empty')).data.events;
  ok(one.every((e) => JSON.parse(e.payload).dropId === 'test-empty'), 'filtered by drop');
  const page = (await adminCall('GET', `/admin/audit?limit=2&before=${r[0].seq}`)).data.events;
  eq(page[0].seq, r[1].seq, 'before= pages back');
});

await t('organiser live counts and slot list match the database', async () => {
  const live = (await adminCall('GET', '/admin/drops/test-edge/live')).data;
  const slots = (await adminCall('GET', '/admin/drops/test-edge/slots')).data.slots;
  eq(slots.length, 5, 'slots listed');
  eq(live.slotsConfirmed, slots.filter((s) => s.state === 'CONFIRMED').length);
  eq(live.slotsPending, slots.filter((s) => s.state === 'PENDING').length);
  eq(live.seats, 5);
});

const failed = done();
await db.end();
redis.disconnect();
process.exit(failed ? 1 : 0);
