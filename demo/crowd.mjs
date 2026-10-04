// Sends a crowd of honest people and bots into a live drop and stops there, so the organiser can
// close entries, score and draw from the dashboard in front of an audience.
//
//   BASE_URL=http://localhost:8080/api/v1 TEST_KEY=... ORGANISER_EMAIL=organiser@fairdrop.test \
//   node demo/crowd.mjs neon-nights S6 --honest 2000 --bots 30 --seconds 90
//
// It reuses the simulator in /simulator (same accounts, same behaviour), so what the dashboard shows is real traffic.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../simulator/src/config.js';
import { Api } from '../simulator/src/api.js';
import { Stats } from '../simulator/src/stats.js';
import { makeRng } from '../simulator/src/rng.js';
import { buildPopulation } from '../simulator/src/population.js';
import { login, runUser } from '../simulator/src/behaviours.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const [dropId, scenario = 'S6', ...rest] = process.argv.slice(2);
if (!dropId) { console.error('usage: node demo/crowd.mjs <dropId> [S0..S6] [--honest N] [--bots PERCENT] [--seconds N]'); process.exit(1); }
const opt = (name, def) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : def; };

const sets = [`dropId=${dropId}`, `honestUsers=${opt('honest', 2000)}`, `windowSeconds=${opt('seconds', 90)}`];
if (scenario.toUpperCase() !== 'S0') sets.push(`botSharePercent=${opt('bots', 30)}`);
const file = path.join(here, '..', 'simulator', 'config', `${{ S0: 's0-baseline', S1: 's1-naive-farm', S2: 's2-stealth-farm', S3: 's3-retry-spammer', S4: 's4-flooder', S5: 's5-payment-reuse', S6: 's6-mixed' }[scenario.toUpperCase()]}.yaml`);
const cfg = loadConfig(file, sets);
for (const k of ['baseUrl', 'testKey', 'organiserEmail']) if (!cfg[k]) throw new Error(`missing ${k}`);

const { users, summary } = buildPopulation(cfg, makeRng(cfg.seed));
console.log(`Crowd for ${dropId}: ${JSON.stringify(summary)} over ${cfg.windowSeconds}s`);

const stats = new Stats();
const api = new Api({ baseUrl: cfg.baseUrl, testKey: cfg.testKey, stats, timeoutMs: cfg.requestTimeoutMs, maxSockets: cfg.concurrency * 3 });
const ctx = { api, cfg, dropId, outcomes: {}, confirmOutcomes: {}, holders: new Set() };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const start = Date.now() + 500;
const byOffset = [...users].sort((a, b) => a.offsetMs - b.offsetMs);
let next = 0;
let done = 0;
const timer = setInterval(() => console.log(`${done}/${users.length} entered or refused, ${stats.line()}`), 5000);
await Promise.all(Array.from({ length: Math.min(cfg.concurrency, users.length) }, async () => {
  for (;;) {
    const i = next++;
    if (i >= byOffset.length) return;
    const wait = start + byOffset[i].offsetMs - Date.now();
    if (wait > 0) await sleep(wait);
    await runUser(ctx, byOffset[i]);
    done++;
  }
}));
clearInterval(timer);
console.log(`Crowd done: ${JSON.stringify(ctx.outcomes)}`);
console.log('Entries are still open. Close, score and draw from the dashboard.');
process.exit(0);
