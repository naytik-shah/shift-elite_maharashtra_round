import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Api } from './api.js';
import { Stats } from './stats.js';
import { makeRng } from './rng.js';
import { buildPopulation } from './population.js';
import { login, runUser, statusAndConfirm, tryConfirm } from './behaviours.js';
import { verifyDraw } from './draw.js';
import { computeResults } from './metrics.js';
import { withDb, entryEmails, guarantees } from './db.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function makeRunId(cfg) {
  const off = Object.entries(cfg.defences)
    .filter(([, on]) => !on)
    .map(([k]) => `no${k}`)
    .join('-');
  const ts = new Date().toISOString().slice(0, 16).replace(':', '-');
  return `${cfg.scenario.toLowerCase()}-${cfg.botSharePercent}pct${off ? '-' + off : ''}-${ts}`;
}

// Workers take tasks in start-time order and wait until each one is due.
async function runPool(tasks, concurrency, startMs, fn, label, stats, useOffsets = false) {
  let next = 0;
  let done = 0;
  const timer = setInterval(() => log(`${label}: ${done}/${tasks.length}, ${stats.line()}`), 5000);
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      if (useOffsets) {
        const wait = startMs + tasks[i].offsetMs - Date.now();
        if (wait > 0) await sleep(wait);
      }
      await fn(tasks[i]);
      done++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  clearInterval(timer);
}

function writeLabels(dir, users) {
  const rows = ['entryId,isBot,botType'];
  for (const u of users) {
    if (u.entryId) rows.push(`${u.entryId},${u.isBot ? 1 : 0},${u.botType || 'none'}`);
  }
  fs.writeFileSync(path.join(dir, 'labels.csv'), rows.join('\n') + '\n');
}

export async function run(cfg, opts = {}) {
  const rng = makeRng(cfg.seed);
  const { users, summary, botCards } = buildPopulation(cfg, rng);
  log(`population: ${JSON.stringify(summary)}, bot cards ${botCards}`);

  if (opts.dry) {
    const sample = (t) => users.find((u) => u.type === t);
    for (const t of Object.keys(summary)) {
      const u = sample(t);
      log(`  ${t}: ${u.email} ip=${u.ip} fp=${u.fp.slice(0, 8)} card=${u.card} at=${Math.round(u.offsetMs)}ms`);
    }
    return;
  }

  for (const k of ['dropId', 'baseUrl', 'testKey', 'organiserEmail']) {
    if (!cfg[k]) throw new Error(`missing ${k} (set it in the config or as an environment variable)`);
  }

  const stats = new Stats();
  const api = new Api({
    baseUrl: cfg.baseUrl,
    testKey: cfg.testKey,
    stats,
    timeoutMs: cfg.requestTimeoutMs,
    maxSockets: cfg.concurrency * 3,
  });
  const dropId = cfg.dropId;
  const runId = makeRunId(cfg);
  const dir = path.join(root, 'runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, 'results'), { recursive: true });

  const ctx = { api, cfg, dropId, outcomes: {}, confirmOutcomes: {}, holders: new Set() };

  // organiser session
  const org = { email: cfg.organiserEmail, ip: '198.51.100.7' };
  const lg = await login(ctx, org, 3);
  if (!lg.ok) throw new Error(`organiser login failed: ${lg.code}`);

  const d = await api.req('GET', `/drops/${dropId}`, { user: org, tag: 'admin' });
  if (d.status !== 200) throw new Error(`drop ${dropId} not found (status ${d.status})`);
  if (d.body.state !== 'OPEN') throw new Error(`drop ${dropId} is ${d.body.state}, a fresh OPEN drop is needed`);
  const seats = d.body.seats;
  const opensIn = Date.parse(d.body.windowOpensAt) - Date.now();
  const closesIn = Date.parse(d.body.windowClosesAt) - Date.now();
  if (closesIn < cfg.windowSeconds * 1000 + 5000) {
    throw new Error(`window closes in ${Math.round(closesIn / 1000)}s, shorter than windowSeconds plus margin`);
  }
  log(`drop ${dropId}: ${seats} seats, ${users.length} accounts planned, run ${runId}`);
  if (opensIn > 0) await sleep(opensIn + 500);

  fs.writeFileSync(
    path.join(dir, 'run.json'),
    JSON.stringify(
      { runId, dropId, scenario: cfg.scenario, botSharePercent: cfg.botSharePercent, defences: cfg.defences, seats, population: summary },
      null,
      2
    )
  );

  // entry phase
  const startMs = Date.now() + 1500;
  const byOffset = [...users].sort((a, b) => a.offsetMs - b.offsetMs);
  await runPool(byOffset, cfg.concurrency, startMs, (u) => runUser(ctx, u), 'entries', stats, true);
  log(`entry phase done: ${JSON.stringify(ctx.outcomes)}`);

  // match entries to accounts, then write labels
  if (cfg.databaseUrl && !opts.noDb) {
    const byEmail = new Map(users.map((u) => [u.email, u]));
    const rows = await withDb(cfg.databaseUrl, (c) => entryEmails(c, dropId));
    for (const r of rows) {
      const u = byEmail.get(String(r.email).toLowerCase());
      if (u) u.entryId = r.id;
    }
  }
  writeLabels(dir, users);
  const labels = new Map(users.filter((u) => u.entryId).map((u) => [u.entryId, { isBot: u.isBot, botType: u.botType }]));
  const byEntry = new Map(users.filter((u) => u.entryId).map((u) => [u.entryId, u]));
  log(`labels: ${labels.size} entries written`);

  // close, score, draw
  const admin = async (method, p, tag, timeoutMs) => {
    const r = await api.req(method, `/admin/drops/${dropId}/${p}`, { user: org, tag, timeoutMs });
    if (r.status !== 200) throw new Error(`${p} failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  await admin('POST', 'close', 'admin');
  log('closed');
  let scoreInfo = null;
  if (cfg.defences.scoring) {
    scoreInfo = await admin('POST', 'score', 'admin', 150000);
    log(`scored: ${JSON.stringify(scoreInfo)}`);
  } else {
    log('scoring skipped (defence off), all weights stay 1.0');
  }
  await admin('POST', 'draw', 'admin');
  log('drawn');

  // reveal: everyone checks status, winners confirm
  await runPool(
    users.filter((u) => u.entryId),
    cfg.concurrency,
    Date.now(),
    (u) => statusAndConfirm(ctx, u),
    'reveal',
    stats
  );
  log(`first confirm pass: ${JSON.stringify(ctx.confirmOutcomes)}`);

  // promotions: wait for unconfirmed seats to expire, then the next people try
  for (let round = 1; round <= cfg.reveal.maxRounds; round++) {
    const s = await api.req('GET', `/admin/drops/${dropId}/slots`, { user: org, tag: 'admin' });
    const pending = (s.body?.slots || []).filter((x) => x.state === 'PENDING');
    if (!pending.length) break;
    const todo = [];
    for (const slot of pending) {
      ctx.holders.add(slot.entryId);
      const u = byEntry.get(slot.entryId);
      if (u && !u.confirmTried && u.willConfirm) todo.push(u);
    }
    if (todo.length) await runPool(todo, cfg.concurrency, Date.now(), (u) => tryConfirm(ctx, u), 'promoted', stats);
    log(`round ${round}: ${pending.length} pending, ${todo.length} tried`);
    if (round === cfg.reveal.maxRounds) break;
    const latest = Math.max(...pending.map((x) => Date.parse(x.confirmBy)));
    const wait = latest - Date.now() + cfg.reveal.workerTickSeconds * 1000;
    if (wait > 0) await sleep(wait);
  }

  // evaluate
  const draw = await verifyDraw(api, org, dropId);
  const slotsRes = await api.req('GET', `/admin/drops/${dropId}/slots`, { user: org, tag: 'admin', timeoutMs: 60000 });
  const slots = slotsRes.body?.slots || [];

  let g = { oversoldSeats: Math.max(0, slots.filter((x) => x.state === 'CONFIRMED').length - seats), cardsWithTwoSeats: null, usersWithTwoEntries: null };
  if (cfg.databaseUrl && !opts.noDb) {
    g = await withDb(cfg.databaseUrl, (c) => guarantees(c, dropId, seats));
  } else {
    log('no database access: cardsWithTwoSeats and usersWithTwoEntries are null');
  }

  const { results, unknown } = computeResults({ runId, cfg, seats, labels, draw, slots, holders: ctx.holders, stats, guarantees: g, botCards });
  if (unknown.entries) log(`warning: ${unknown.entries} entries in the draw have no label`);
  if (!draw.ok) log(`warning: draw check failed ${JSON.stringify(draw.checks || draw.reason)}`);

  const file = path.join(root, 'results', `${runId}.json`);
  fs.writeFileSync(file, JSON.stringify(results, null, 2) + '\n');
  fs.writeFileSync(
    path.join(dir, 'summary.json'),
    JSON.stringify({ outcomes: ctx.outcomes, confirmOutcomes: ctx.confirmOutcomes, httpCodes: stats.codes, netErrors: stats.netErrors, score: scoreInfo, drawChecks: draw.checks, unknown }, null, 2)
  );
  log(`saved ${path.relative(root, file)}`);

  if (!opts.noUpload) {
    const up = await api.req('POST', '/admin/runs', { user: org, tag: 'admin', body: results });
    log(up.status === 201 ? 'results uploaded' : `upload failed: ${up.status} ${JSON.stringify(up.body)}`);
  }

  log(
    `advantage ${results.botAdvantageRatio}, honest deviation ${results.honestFairShareDeviation}, false positives ${results.falsePositiveRate}, ` +
      `winners ${JSON.stringify(results.winners)}, confirmed ${JSON.stringify(results.confirmed)}, 5xx ${results.errors5xx}, 429s ${results.rateLimited}`
  );
  return results;
}
