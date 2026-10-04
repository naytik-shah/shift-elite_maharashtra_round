// Bot population test through the real API. Honest users and bots sign in and enter, the organiser closes,
// weights are applied, the draw runs and winners try to confirm. Labels never leave this script.
//
//   SCENARIO=S1 BOT_PCT=30 USERS=3000 TEST_KEY=... node bot-sim.mjs
//
// SCENARIO: S0 honest only, S1 naive farm, S2 stealth farm, S5 payment reuse (stealth bots plus a tiny card pool),
//           S6 mixed (S1, S2 and a flooder in equal parts).
// MODE:     none (everyone weight 1.0), rule (the PRD 9.2 fallback rule, built in below) or oracle (bots 0.05).
//           MODE only decides the weights used in the real draw. The report also compares all three offline
//           over many seeds with the same entries.
// There is no scoring service yet, so weights are written straight into the database between close and draw,
// which is exactly where the scoring service will write them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  TEST_KEY, sleep, rid, api, login, solvePow, enter, confirm, adminCall, pmap, rankEntries,
  dbClient, redisClient, flushRedis, CACHE_PATTERNS, resetDrop,
} from './lib.mjs';
import { checkInvariants } from './invariants.mjs';

if (!TEST_KEY) { console.error('Set TEST_KEY.'); process.exit(1); }

const SCENARIO = (process.env.SCENARIO || 'S6').toUpperCase();
const MODE = process.env.MODE || 'rule';
const N = Number(process.env.USERS || 3000);
const BOT_PCT = SCENARIO === 'S0' ? 0 : Number(process.env.BOT_PCT || 30);
const CARDS = Number(process.env.BOT_CARDS || 40);
const DROP = process.env.DROP_ID || 'test-load';
const CONC = Number(process.env.CONC || 120);
const SPREAD_MS = Number(process.env.SPREAD_MS || 15000);
const SEEDS = Number(process.env.OFFLINE_SEEDS || 300);
const OUT_DIR = process.env.OUT_DIR || new URL('./sim-results/', import.meta.url).pathname;
const INSTITUTION = 'college.edu';

const rnd = (n) => crypto.randomInt(0, n);
const pick = (a) => a[rnd(a.length)];
const FIRST = ['asha', 'ravi', 'meera', 'kunal', 'isha', 'dev', 'tara', 'neil', 'riya', 'arjun', 'zoya', 'vikram', 'sana', 'omkar'];
const LAST = ['shah', 'patil', 'mehta', 'rao', 'khan', 'joshi', 'nair', 'iyer', 'gupta', 'desai', 'kulkarni', 'singh'];
const DOMAINS = ['gmail.com', 'outlook.com', 'yahoo.com', 'proton.me', 'icloud.com'];
const humanEmail = () => `${pick(FIRST)}${pick(['.', '_', ''])}${pick(LAST)}${rnd(4) ? rnd(99) : ''}.${rid()}@${pick(DOMAINS)}`;
let subnetCounter = crypto.randomInt(0, 200);
const freshIp = () => { const n = subnetCounter++ % 60000; return `10.${(n >> 8) & 255}.${n & 255}.${1 + rnd(250)}`; };

// ------------------------------------------------------------------ population
function makePopulation() {
  const bots = Math.round((N * BOT_PCT) / 100);
  const users = [];
  // honest: spread over many subnets, about 8% on five shared college subnets, varied emails
  const collegeNets = Array.from({ length: 5 }, () => freshIp().split('.').slice(0, 3).join('.'));
  for (let i = 0; i < N - bots; i++) {
    const college = rnd(100) < 8;
    users.push({
      label: 'honest',
      email: college ? `${21 + rnd(4)}bce${1000 + rnd(9000)}${rid()}@${INSTITUTION}` : humanEmail(),
      ip: college ? `${pick(collegeNets)}.${1 + rnd(250)}` : freshIp(),
      fp: rid() + rid(),
      delay: rnd(SPREAD_MS),
      card: `card_honest_${rid()}${rid()}`,
    });
  }
  const types = SCENARIO === 'S1' ? ['S1'] : SCENARIO === 'S2' || SCENARIO === 'S5' ? ['S2'] : SCENARIO === 'S6' ? ['S1', 'S2', 'S4'] : [];
  const farmFp = rid();
  const farmNet = freshIp().split('.').slice(0, 3).join('.');
  let seq = 0;
  for (let i = 0; i < bots; i++) {
    const type = types[i % types.length];
    if (type === 'S1') {
      users.push({ label: 'bot', botType: 'S1', email: `farmer${++seq}.${rid()}@mailfarm.test`, ip: `${farmNet}.${1 + (seq % 250)}`, fp: farmFp, delay: rnd(1500), card: `card_bot_${rnd(CARDS)}`, retry: false });
    } else if (type === 'S4') {
      // flooder: skips the entry puzzle's real work by hammering, one address, tight burst
      users.push({ label: 'bot', botType: 'S4', email: `flood${i}.${rid()}@mailfarm.test`, ip: `${freshIp().split('.').slice(0, 3).join('.')}.5`, fp: rid(), delay: rnd(300), card: `card_bot_${rnd(CARDS)}`, retry: false, hammer: 6 });
    } else {
      users.push({ label: 'bot', botType: 'S2', email: humanEmail(), ip: freshIp(), fp: rid() + rid(), delay: rnd(SPREAD_MS), card: `card_bot_${rnd(CARDS)}`, retry: false });
    }
  }
  return users;
}

// ------------------------------------------------------------------ run one user through sign in and entry
const outcome = { entered: { honest: 0, bot: 0 }, refused: { honest: 0, bot: 0 }, rateLimited: { honest: 0, bot: 0 }, errors5xx: 0 };
async function runUser(u) {
  await sleep(u.delay);
  const side = u.label === 'bot' ? 'bot' : 'honest';
  const attempts = u.retry === false ? 1 : 4;
  for (let a = 0; a < attempts; a++) {
    try {
      if (!u.cookie) {
        const s = await login(u.email, u.ip);
        u.cookie = s.cookie;
        u.id = s.user.id;
      }
      let r;
      for (let k = 0; k < (u.hammer || 1); k++) r = await enter(u, DROP, u.fp);
      if (r.status === 201 || r.code === 'ALREADY_ENTERED') { u.entered = true; outcome.entered[side]++; return; }
      if (r.status === 429) { outcome.rateLimited[side]++; await sleep(Number(r.headers.get('retry-after') || 2) * 1000); continue; }
      if (r.status >= 500) outcome.errors5xx++;
      outcome.refused[side]++;
      return;
    } catch (err) {
      if (/429|RATE/.test(err.message)) { outcome.rateLimited[side]++; await sleep(2000); continue; }
      outcome.refused[side]++;
      return;
    }
  }
  outcome.refused[side]++;
}

// ------------------------------------------------------------------ reference rule scorer (PRD 9.2 fallback)
const tier = (risk) => (risk >= 85 ? 0.05 : risk >= 60 ? 0.2 : risk >= 30 ? 0.5 : 1);
const subnet = (ip) => ip.split('.').slice(0, 3).join('.');
const stem = (email) => email.split('@')[0].replace(/[._]?[0-9a-f]{10}$/, '').replace(/\d+/g, '#');

function ruleScores(rows) {
  const byFp = new Map(); const bySub = new Map(); const byStem = new Map();
  for (const r of rows) {
    r.sub = subnet(r.ip); r.domain = r.email.split('@')[1]; r.t = new Date(r.created_at).getTime(); r.stem = `${stem(r.email)}@${r.domain}`;
    (byFp.get(r.fp) || byFp.set(r.fp, []).get(r.fp)).push(r);
    (bySub.get(r.sub) || bySub.set(r.sub, []).get(r.sub)).push(r);
    (byStem.get(r.stem) || byStem.set(r.stem, []).get(r.stem)).push(r);
  }
  const sizes = [...bySub.values()].map((g) => g.length).sort((a, b) => a - b);
  const median = Math.max(1, sizes[Math.floor(sizes.length / 2)]);
  const clamp = (x) => Math.max(0, Math.min(1, x));
  for (const r of rows) {
    const fpGroup = byFp.get(r.fp);
    const fpSubnets = new Set(fpGroup.map((x) => x.sub)).size;
    // a fingerprint spread over many unrelated networks looks like a common phone, not a farm
    const device = fpGroup.length >= 3 && fpSubnets / fpGroup.length < 0.5 ? clamp(fpGroup.length / 10) : 0;
    const subGroup = bySub.get(r.sub);
    const ip = clamp((subGroup.length / median - 3) / 10);
    const near = subGroup.filter((x) => Math.abs(x.t - r.t) < 1500).length;
    const timing = subGroup.length >= 10 ? clamp(near / 15) : 0;
    const stemGroup = byStem.get(r.stem);
    const email = r.domain === INSTITUTION ? 0 : clamp((stemGroup.length - 2) / 15);
    const strong = [device, ip, timing, email].filter((x) => x >= 0.5).length;
    let risk = Math.round(100 * (0.35 * device + 0.25 * ip + 0.2 * timing + 0.2 * email) * 1.6);
    risk = Math.min(100, risk);
    r.risk = risk;
    r.weight = strong >= 2 ? tier(risk) : 1; // two-signal guard
  }
}

// ------------------------------------------------------------------ main
console.log(`Bot sim: scenario ${SCENARIO}, ${N} users, ${BOT_PCT}% bots, draw weights "${MODE}", drop "${DROP}"`);
const db = await dbClient();
const redis = await redisClient();
await resetDrop(db, redis, DROP);
await flushRedis(redis, CACHE_PATTERNS);
const SEATS = (await db.query('SELECT seats FROM drops WHERE id = $1', [DROP])).rows[0].seats;

const users = makePopulation();
const labelByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
let t0 = Date.now();
await pmap(users, runUser, CONC);
console.log(`Entries: honest ${outcome.entered.honest}/${users.filter((u) => u.label === 'honest').length}, bots ${outcome.entered.bot}/${users.filter((u) => u.label === 'bot').length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`Refused by rate limits at least once: honest ${outcome.rateLimited.honest}, bots ${outcome.rateLimited.bot}. 5xx: ${outcome.errors5xx}`);

const closed = await adminCall('POST', `/admin/drops/${DROP}/close`);
if (closed.status !== 200) throw new Error(`close failed ${closed.status}`);

// entries with their features
const { rows } = await db.query(
  `SELECT e.id, e.device_fp AS fp, host(e.ip) AS ip, e.created_at, u.email
     FROM entries e JOIN users u ON u.id = e.user_id WHERE e.drop_id = $1`, [DROP]);
for (const r of rows) {
  const u = labelByEmail.get(r.email.toLowerCase());
  r.isBot = u?.label === 'bot'; r.botType = u?.botType; r.user = u;
}
ruleScores(rows);

const weightsFor = (mode, r) => (mode === 'none' ? 1 : mode === 'oracle' ? (r.isBot ? 0.05 : 1) : r.weight);
const entriesBots = rows.filter((r) => r.isBot).length;
const botShareEntries = entriesBots / rows.length;

// offline comparison across many seeds
const offline = {};
for (const mode of ['none', 'rule', 'oracle']) {
  const manifest = rows.map((r) => ({ entryId: r.id, weight: weightsFor(mode, r) }));
  const isBot = new Map(rows.map((r) => [r.id, r.isBot]));
  let botWins = 0;
  for (let s = 0; s < SEEDS; s++) for (const id of rankEntries(`offline-${s}-${mode}`, manifest).slice(0, SEATS)) if (isBot.get(id)) botWins++;
  const share = botWins / (SEEDS * SEATS);
  offline[mode] = { botShareOfWinners: +share.toFixed(4), botAdvantageRatio: botShareEntries ? +(share / botShareEntries).toFixed(3) : 0 };
}
const flaggedHonest = rows.filter((r) => !r.isBot && r.weight < 1).length;
const honestN = rows.filter((r) => !r.isBot).length;
const flaggedBots = rows.filter((r) => r.isBot && r.weight < 1).length;
const byType = {};
for (const r of rows.filter((x) => x.isBot)) { const k = r.botType; byType[k] ||= { n: 0, flagged: 0 }; byType[k].n++; if (r.weight < 1) byType[k].flagged++; }

// apply the chosen weights and run the real draw
await db.query(
  'UPDATE entries e SET risk = v.risk, weight = v.weight FROM (SELECT unnest($1::uuid[]) id, unnest($2::int[]) risk, unnest($3::numeric[]) weight) v WHERE e.id = v.id',
  [rows.map((r) => r.id), rows.map((r) => (MODE === 'oracle' ? (r.isBot ? 95 : 0) : MODE === 'none' ? 0 : r.risk)), rows.map((r) => weightsFor(MODE, r))]);
const draw = await adminCall('POST', `/admin/drops/${DROP}/draw`);
if (draw.status !== 200) throw new Error(`draw failed ${draw.status} ${JSON.stringify(draw.data)}`);

const states = (await db.query("SELECT id, state, rank FROM entries WHERE drop_id = $1", [DROP])).rows;
const stateById = new Map(states.map((s) => [s.id, s.state]));
const winners = rows.filter((r) => stateById.get(r.id) === 'WON');
const winnersBot = winners.filter((r) => r.isBot).length;
const cardOutcome = { honest: { ok: 0, blocked: 0 }, bot: { ok: 0, blocked: 0 } };
await pmap(winners, async (r) => {
  const side = r.isBot ? 'bot' : 'honest';
  const c = await confirm(r.user, DROP, r.user.card, 'Test Payer');
  if (c.status === 200) cardOutcome[side].ok++; else cardOutcome[side].blocked++;
}, 40);

const invariants = await checkInvariants(db, DROP);
const honestWinRate = (winners.length - winnersBot) / honestN;
const fairRate = Math.min(1, SEATS / honestN);
const result = {
  runId: `${SCENARIO.toLowerCase()}-${BOT_PCT}pct-${MODE}-${new Date().toISOString().slice(0, 16).replace(':', '-')}`,
  scenario: SCENARIO, botSharePercent: BOT_PCT, drawWeights: MODE,
  defences: { pow: 'test difficulty only', rateLimits: true, scoring: MODE },
  config: { seats: SEATS, users: N, botCards: CARDS },
  entries: { honest: honestN, bot: entriesBots },
  entryAttempts: { honest: users.filter((u) => u.label === 'honest').length, bot: users.filter((u) => u.label === 'bot').length },
  rateLimitedAtLeastOnce: outcome.rateLimited,
  winners: { honest: winners.length - winnersBot, bot: winnersBot },
  confirmed: { honest: cardOutcome.honest.ok, bot: cardOutcome.bot.ok },
  botAdvantageRatio: botShareEntries && winners.length ? +((winnersBot / winners.length) / botShareEntries).toFixed(3) : 0,
  botSeatConversion: winnersBot ? +(cardOutcome.bot.ok / winnersBot).toFixed(3) : null,
  honestFairShareDeviation: +(Math.abs(honestWinRate / fairRate - 1)).toFixed(3),
  falsePositiveRate: +(flaggedHonest / honestN).toFixed(4),
  botsFlagged: { total: flaggedBots, of: entriesBots, byType },
  offlineAverageOver: `${SEEDS} seeds`, offline,
  errors5xx: outcome.errors5xx,
  hardGuarantees: { invariantViolations: invariants },
};
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, `${result.runId}.json`), JSON.stringify(result, null, 2));
console.log(`\n${JSON.stringify(result, null, 2)}`);
console.log(invariants.length ? `\nINVARIANTS BROKEN: ${invariants.join('; ')}` : '\nAll database invariants hold.');
await db.end();
redis.disconnect();
process.exit(invariants.length ? 1 : 0);
