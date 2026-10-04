// Builds training data without a server. Uses the same population as a live run, then
// works out which accounts would get an entry past the puzzle and rate limits, and writes
// run.json, labels.csv and entries.csv (same columns as scoring/export_entries.py).
//
// usage: node src/offline.js <config.yaml> [--seeds 1-5] [--set key=value] [--out runs]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { makeRng } from './rng.js';
import { buildPopulation } from './population.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// server limits that decide who gets in (PRD 9.4)
const LIMITS = { ipCodes: 5, emailCodes: 3, sessionEntries: 5 };

function uuid(rng) {
  const h = rng.hex(32).split('');
  h[12] = '4';
  h[16] = '89ab'[Math.floor(rng.next() * 4)];
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

const between = (rng, lo, hi) => lo + rng.next() * (hi - lo);

// request latency in ms, skewed like a real network
function latency(rng) {
  const z = Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());
  return Math.max(2, Math.exp(Math.log(12) + 0.6 * z));
}

class Budget {
  constructor(limit, on) {
    this.limit = limit;
    this.on = on;
    this.used = new Map();
  }
  take(key) {
    if (!this.on) return true;
    const n = this.used.get(key) || 0;
    this.used.set(key, n + 1);
    return n < this.limit;
  }
}

// Returns the time (ms from window start) the entry lands, or null if blocked.
function simulateUser(u, cfg, rng, b) {
  const rl = cfg.defences.rateLimits;
  const powOn = cfg.defences.pow;
  const codeReq = () => b.ipCodes.take(u.ip) & b.emailCodes.take(u.email);
  let t = u.offsetMs;

  if (u.type === 'honest' || u.type === 's1' || u.type === 's2' || u.type === 's5') {
    const think = u.type === 'honest' ? cfg.honest.thinkMs : u.type === 's1' ? null : [200, 1500];
    const retries = u.type === 'honest' ? cfg.honest.retry429 : u.retry429 ?? 0;
    if (think) t += between(rng, think[0], think[1]);
    let ok = false;
    for (let i = 0; i <= retries && !ok; i++) ok = codeReq();
    if (!ok) return null;
    if (think) t += between(rng, think[0], think[1]);
    return t + 4 * latency(rng);
  }

  if (u.type === 's3') {
    const p = cfg.bots.s3;
    for (let i = 0; i < p.codeSpam; i++) codeReq();
    if (!codeReq()) return null;
    // entry spam: the first accepted one counts, the rest hit ALREADY_ENTERED
    let entered = false;
    for (let i = 0; i < p.entrySpam && !entered; i++) entered = b.sessions.take(u.email) || !rl;
    return entered ? t + 3 * latency(rng) + rng.int(0, 400) : null;
  }

  if (u.type === 's4') {
    const p = cfg.bots.s4;
    const attemptOk = () => !rng.chance(p.fakeShare) || !powOn;
    let code = false;
    for (let a = 0; a < p.attempts && !code; a++) {
      const real = attemptOk();
      code = codeReq() && real;
      t += latency(rng);
    }
    if (!code) return null;
    let entered = false;
    for (let a = 0; a < p.attempts && !entered; a++) {
      const real = attemptOk();
      entered = b.sessions.take(u.email) && real;
      t += latency(rng);
    }
    return entered ? t : null;
  }
  return null;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildRun(cfg, seed, outDir) {
  const rng = makeRng(seed);
  const { users, summary } = buildPopulation(cfg, rng);
  // separate stream for outcomes so the population matches a live run with the same seed
  const orng = makeRng(seed * 7919 + 13);
  const rl = cfg.defences.rateLimits;
  const b = {
    ipCodes: new Budget(LIMITS.ipCodes, rl),
    emailCodes: new Budget(LIMITS.emailCodes, rl),
    sessions: new Budget(LIMITS.sessionEntries, rl),
  };

  const t0 = Date.parse('2026-10-04T10:00:00Z');
  const rows = [];
  const outcomes = {};
  for (const u of [...users].sort((a, c) => a.offsetMs - c.offsetMs)) {
    const at = simulateUser(u, cfg, orng, b);
    const k = `${u.type}:${at === null ? 'blocked' : 'entered'}`;
    outcomes[k] = (outcomes[k] || 0) + 1;
    if (at === null) continue;
    u.entryId = uuid(orng);
    // the puzzle time is measured on the server, issue to answer; with the test difficulty
    // every client solves it in a few ms, so it is mostly network time
    const powMs = cfg.defences.pow ? Math.round(latency(orng) + orng.int(0, 6)) : null;
    rows.push({
      id: u.entryId,
      user_id: uuid(orng),
      device_fp: u.fp,
      ip: u.ip,
      pow_server_ms: powMs,
      created_at: new Date(t0 + at).toISOString(),
      email: u.email.toLowerCase(),
      _u: u,
    });
  }
  rows.sort((a, c) => a.created_at.localeCompare(c.created_at));

  const off = Object.entries(cfg.defences).filter(([, on]) => !on).map(([k]) => `no${k}`).join('-');
  const runId = `off-${cfg.scenario.toLowerCase()}-${cfg.botSharePercent}pct${off ? '-' + off : ''}-seed${seed}`;
  const dir = path.join(outDir, runId);
  fs.mkdirSync(dir, { recursive: true });

  const cols = ['id', 'user_id', 'device_fp', 'ip', 'pow_server_ms', 'created_at', 'email'];
  fs.writeFileSync(
    path.join(dir, 'entries.csv'),
    [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'
  );
  fs.writeFileSync(
    path.join(dir, 'labels.csv'),
    ['entryId,isBot,botType', ...rows.map((r) => `${r.id},${r._u.isBot ? 1 : 0},${r._u.botType || 'none'}`)].join('\n') + '\n'
  );
  fs.writeFileSync(
    path.join(dir, 'run.json'),
    JSON.stringify(
      { runId, dropId: 'offline', offline: true, seed, scenario: cfg.scenario, botSharePercent: cfg.botSharePercent,
        defences: cfg.defences, seats: 500, population: summary, outcomes },
      null,
      2
    ) + '\n'
  );
  const bots = rows.filter((r) => r._u.isBot).length;
  return { runId, entries: rows.length, bots, outcomes };
}

function parseSeeds(s) {
  const m = /^(\d+)-(\d+)$/.exec(s);
  if (m) return Array.from({ length: +m[2] - +m[1] + 1 }, (_, i) => +m[1] + i);
  return s.split(',').map(Number);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const sets = [];
  let file = null;
  let seeds = null;
  let out = path.join(root, 'runs');
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--set') sets.push(args[++i]);
    else if (a === '--seeds') seeds = parseSeeds(args[++i]);
    else if (a === '--out') out = path.resolve(args[++i]);
    else file = a;
  }
  if (!file) {
    console.error('usage: node src/offline.js <config.yaml> [--seeds 1-5] [--set key=value] [--out dir]');
    process.exit(1);
  }
  const base = loadConfig(file, sets);
  for (const seed of seeds || [base.seed]) {
    const cfg = { ...structuredClone(base), seed };
    const r = buildRun(cfg, seed, out);
    console.log(`${r.runId}: ${r.entries} entries, ${r.bots} bots, ${JSON.stringify(r.outcomes)}`);
  }
}
