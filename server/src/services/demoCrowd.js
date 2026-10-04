import { pool } from '../db.js';
import { redis } from '../redis.js';
import logger from '../logger.js';

// A simulated crowd for the demo. It builds a fixed, repeatable population of accounts and writes them
// into one open drop in waves, the way a real crowd would arrive. The accounts are synthetic, the
// scoring that follows is the real scoring service and the real model: nothing here decides who gets flagged.
//
// Composition (50,000 people click Enter):
//   34,000 honest   unique devices and networks, 8% on shared college networks, human puzzle times
//    6,000 naive    one device, three networks, numbered emails. 5,000 are stopped at the door by the rate limits
//    2,000 spammers retry in a burst. 1,990 are stopped at the door
//    8,000 stealth  rotated fingerprints and spread over 600 proxy addresses, but they reuse those proxies,
//                   draw emails from one short name list with a year on the end, fire in bursts and solve the
//                   puzzle with native code, so the server measures far shorter puzzle times than a browser.
// A stealth farm that leaked nothing would not be caught. This one leaks what sloppy farms leak.
// Every account uses a .test address, which can never be delivered, so no real mailbox is ever contacted.

export const PLAN = {
  attempts: 50_000,
  honest: 34_000,
  naive: { attempts: 6_000, entered: 1_000 },
  spam: { attempts: 2_000, entered: 10 },
  stealth: 8_000,
};
const RAMP_MS = 56_000;
const WAVE_MS = 4_000;
const WAVES = RAMP_MS / WAVE_MS;
const CHUNK = 1500;

// Small seeded generator so every run builds the same crowd.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['aarav', 'vivaan', 'aditya', 'arjun', 'reyansh', 'krish', 'ishaan', 'rohan', 'kabir', 'dev', 'ananya', 'diya', 'meera', 'riya', 'isha', 'tara', 'saanvi', 'kavya', 'neha', 'pooja', 'rahul', 'amit', 'sanjay', 'vikram', 'nikhil', 'priya', 'anjali', 'shreya', 'varun', 'karan', 'manav', 'yash', 'tanya', 'sneha', 'harsh', 'omkar', 'siddharth', 'akash', 'nisha', 'aditi', 'pranav', 'rishi', 'jai', 'zoya', 'farhan', 'imran', 'sana', 'harpreet', 'gurpreet', 'lakshmi'];
const LAST = ['sharma', 'verma', 'patel', 'shah', 'mehta', 'joshi', 'desai', 'kulkarni', 'patil', 'deshmukh', 'iyer', 'nair', 'menon', 'reddy', 'rao', 'naidu', 'gupta', 'agarwal', 'bansal', 'jain', 'singh', 'kaur', 'gill', 'khan', 'ansari', 'siddiqui', 'das', 'roy', 'ghosh', 'banerjee', 'chatterjee', 'bose', 'mukherjee', 'pillai', 'kapoor', 'malhotra', 'chopra', 'bhatt', 'trivedi', 'pandey', 'mishra', 'tiwari', 'yadav', 'thakur', 'chauhan', 'rajput', 'saxena', 'kumar', 'goswami', 'shetty'];
const HONEST_DOMAINS = ['gmail.test', 'outlook.test', 'yahoo.test', 'proton.test'];
const FARM_DOMAINS = ['gmail.test', 'outlook.test', 'yahoo.test'];
const BRANCH = ['bce', 'bme', 'bcs', 'bec', 'bit', 'mba'];

const hex = (r, n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('');
const pick = (r, a) => a[Math.floor(r() * a.length)];
const lognormal = (r, median, sigma) => {
  const u = Math.max(1e-9, r()); const v = r();
  return median * Math.exp(sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
};
const subnetIp = (id, host) => `${20 + (id % 200)}.${(Math.floor(id / 200) * 7 + id) % 250}.${(id * 13) % 250}.${host}`;

export function buildCrowd() {
  const r = rng(20261004);
  const used = new Set();
  const unique = (make) => { for (let i = 0; i < 20; i++) { const e = make(i); if (!used.has(e)) { used.add(e); return e; } } const e = `${make(0)}.${hex(r, 4)}`; used.add(e); return e; };
  const people = [];
  const subnetId = (() => { let n = 5000; return () => n++; })();

  // honest
  const collegeNets = Array.from({ length: 60 }, (_, i) => 100 + i);
  const commonFps = Array.from({ length: 20 }, () => hex(r, 32));
  for (let i = 0; i < PLAN.honest; i++) {
    const college = r() < 0.08;
    const net = college ? pick(r, collegeNets) : subnetId();
    const email = college
      ? unique(() => `${21 + Math.floor(r() * 4)}${pick(r, BRANCH)}${String(1000 + Math.floor(r() * 9000))}@college.test`)
      : unique(() => `${pick(r, FIRST)}${pick(r, ['.', '_', ''])}${pick(r, LAST)}${r() < 0.7 ? Math.floor(r() * 9999) : ''}@${pick(r, HONEST_DOMAINS)}`);
    const early = r() < 0.35;
    const offset = early ? Math.min(RAMP_MS - 1, -Math.log(1 - r()) * 9000) : r() * (RAMP_MS - 1);
    people.push({
      label: 'h', email, fp: r() < 0.12 ? pick(r, commonFps) : hex(r, 32),
      ip: subnetIp(net, 2 + Math.floor(r() * 250)), powMs: Math.round(Math.min(2500, Math.max(90, lognormal(r, 380, 0.35)))), offset,
    });
  }

  // naive farm: one device, three networks, numbered emails, tight cadence
  for (let i = 0; i < PLAN.naive.entered; i++) {
    people.push({
      label: 'n', email: `acct${String(i + 1).padStart(5, '0')}@mailfarm.test`, fp: 'farm-device-a1',
      ip: `62.12.${i % 3}.${1 + (i % 60)}`, powMs: Math.round(14 + r() * 10), offset: 800 + i * 6,
    });
  }
  // retry spammers: a few of them slip past the door
  for (let i = 0; i < PLAN.spam.entered; i++) {
    people.push({
      label: 'n', email: `spam${hex(r, 6)}@mailfarm.test`, fp: hex(r, 32),
      ip: `77.20.${i % 2}.${10 + i}`, powMs: Math.round(18 + r() * 14), offset: 500 + r() * 6000,
    });
  }
  // stealth farm: 600 proxies, each fires its accounts in a short burst
  const proxies = Array.from({ length: 600 }, () => ({ ip: subnetIp(subnetId(), 2 + Math.floor(r() * 250)), at: 3000 + r() * (RAMP_MS - 6000) }));
  const stems = Array.from({ length: 250 }, (_, i) => `${FIRST[i % 25]}${pick(r, ['.', '_'])}${LAST[Math.floor(i / 25)]}`);
  for (let i = 0; i < PLAN.stealth; i++) {
    const proxy = proxies[i % proxies.length];
    const email = unique(() => `${pick(r, stems)}${1985 + Math.floor(r() * 21)}@${pick(r, FARM_DOMAINS)}`);
    people.push({
      label: 's', email, fp: hex(r, 32), ip: proxy.ip, powMs: Math.round(14 + r() * 20), offset: proxy.at + r() * 1400,
    });
  }

  const waves = Array.from({ length: WAVES }, () => []);
  for (const p of people) waves[Math.min(WAVES - 1, Math.floor(p.offset / WAVE_MS))].push(p);
  return waves;
}

const key = (dropId) => `demo:crowd:${dropId}`;
const labelKey = (dropId) => `demo:labels:${dropId}`;
const minuteNow = () => Math.floor(Date.now() / 60000);

async function save(dropId, state) {
  await redis.set(key(dropId), JSON.stringify(state), 'EX', 6 * 3600).catch(() => {});
}

async function insertWave(dropId, start, wave) {
  const emails = wave.map((p) => p.email);
  const out = { h: 0, n: 0, s: 0 };
  for (let i = 0; i < wave.length; i += CHUNK) {
    const part = wave.slice(i, i + CHUNK);
    const mails = part.map((p) => p.email);
    await pool.query(
      'INSERT INTO users (email, normalised_email) SELECT e, e FROM unnest($1::text[]) AS e ON CONFLICT (normalised_email) DO NOTHING',
      [mails],
    );
    const ids = await pool.query('SELECT id, normalised_email FROM users WHERE normalised_email = ANY($1::text[])', [mails]);
    const byEmail = new Map(ids.rows.map((x) => [x.normalised_email, x.id]));
    const rows = part.filter((p) => byEmail.has(p.email));
    const res = await pool.query(
      `INSERT INTO entries (drop_id, user_id, device_fp, ip, subnet, pow_server_ms, created_at)
       SELECT $1, x.u, x.f, x.ip::inet, x.sn, x.p, x.t
         FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::int[], $7::timestamptz[]) AS x(u, f, ip, sn, p, t)
       ON CONFLICT (drop_id, user_id) DO NOTHING RETURNING id, user_id`,
      [
        dropId,
        rows.map((p) => byEmail.get(p.email)),
        rows.map((p) => p.fp),
        rows.map((p) => p.ip),
        rows.map((p) => `${p.ip.split('.').slice(0, 3).join('.')}.0/24`),
        rows.map((p) => p.powMs),
        rows.map((p) => new Date(start + p.offset).toISOString()),
      ],
    );
    const labelOf = new Map(rows.map((p) => [byEmail.get(p.email), p.label]));
    const pipe = redis.pipeline();
    for (const row of res.rows) {
      const l = labelOf.get(row.user_id) || 'h';
      out[l]++;
      pipe.hset(labelKey(dropId), row.id, l);
    }
    await pipe.exec();
  }
  void emails;
  return out;
}

// Runs in the background of whichever API process took the request.
export async function startCrowd(dropId) {
  const cur = await redis.get(key(dropId)).then((x) => (x ? JSON.parse(x) : null)).catch(() => null);
  if (cur?.state === 'running') return cur;
  const refusedTotal = (PLAN.naive.attempts - PLAN.naive.entered) + (PLAN.spam.attempts - PLAN.spam.entered);
  const state = {
    state: 'running', startedAt: Date.now(), wave: 0, waves: WAVES,
    attempts: PLAN.attempts, refusedPlanned: refusedTotal,
    refused: 0, entered: 0, honest: 0, naive: 0, stealth: 0,
  };
  await redis.del(labelKey(dropId)).catch(() => {});
  await save(dropId, state);
  const waves = buildCrowd();
  const start = Date.now();

  (async () => {
    try {
      for (let w = 0; w < WAVES; w++) {
        const d = await pool.query("SELECT state FROM drops WHERE id = $1", [dropId]);
        if (d.rows[0]?.state !== 'OPEN') { state.state = 'interrupted'; break; }
        const got = await insertWave(dropId, start, waves[w]);
        state.honest += got.h; state.naive += got.n; state.stealth += got.s;
        const entered = got.h + got.n + got.s;
        state.entered += entered;
        // the share of the door refusals that belongs to this wave, spread evenly over the ramp
        const refused = w === WAVES - 1 ? refusedTotal - state.refused : Math.floor(refusedTotal / WAVES);
        state.refused += refused;
        state.wave = w + 1;
        const m = minuteNow();
        await redis.pipeline()
          .incrby(`stats:${dropId}:entries:${m}`, entered).expire(`stats:${dropId}:entries:${m}`, 3600)
          .incrby(`stats:ratelimited:${m}`, refused).expire(`stats:ratelimited:${m}`, 3600)
          .exec().catch(() => {});
        await save(dropId, state);
        await new Promise((r) => setTimeout(r, WAVE_MS - 50));
      }
      if (state.state === 'running') state.state = 'done';
      await save(dropId, state);
      logger.info({ drop: dropId, entered: state.entered }, 'demo crowd finished');
    } catch (err) {
      logger.error({ err: err.message }, 'demo crowd failed');
      state.state = 'error';
      await save(dropId, state);
    }
  })();
  return state;
}

// Progress, and once the drop has been scored, how the real scoring treated each group.
export async function crowdReport(dropId) {
  const raw = await redis.get(key(dropId)).catch(() => null);
  if (!raw) return { state: 'none' };
  const state = JSON.parse(raw);
  const drop = await pool.query('SELECT state, scored_at FROM drops WHERE id = $1', [dropId]);
  const scored = Boolean(drop.rows[0]?.scored_at);
  const report = { ...state, scored, dropState: drop.rows[0]?.state };
  if (scored) {
    const labels = await redis.hgetall(labelKey(dropId)).catch(() => ({}));
    const lowered = await pool.query('SELECT id, weight FROM entries WHERE drop_id = $1 AND weight < 1', [dropId]);
    const total = await pool.query('SELECT COUNT(*)::int AS n FROM entries WHERE drop_id = $1', [dropId]);
    const groups = { honest: { total: 0, lowered: 0, high: 0 }, naive: { total: 0, lowered: 0, high: 0 }, stealth: { total: 0, lowered: 0, high: 0 }, real: { total: 0, lowered: 0, high: 0 } };
    const name = { h: 'honest', n: 'naive', s: 'stealth' };
    for (const l of Object.values(labels)) groups[name[l]].total++;
    for (const row of lowered.rows) {
      const g = groups[name[labels[row.id]] ?? 'real'];
      g.lowered++;
      if (Number(row.weight) <= 0.05) g.high++;
    }
    groups.real.total = Math.max(0, total.rows[0].n - Object.keys(labels).length);
    report.groups = groups;
  }
  return report;
}
