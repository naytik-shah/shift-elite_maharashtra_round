import fs from 'node:fs';
import YAML from 'yaml';

const DEFAULTS = {
  scenario: 'S0',
  dropId: null,
  baseUrl: null,
  honestUsers: 2000,
  botSharePercent: 0,
  windowSeconds: 120,
  concurrency: 300,
  seed: 1,
  nonceAsNumber: false,
  requestTimeoutMs: 30000,
  emailDomains: ['fairdrop.test'],
  defences: { pow: true, rateLimits: true, scoring: true },
  honest: {
    collegeShare: 0.08,
    collegeSubnets: 12,
    commonFpShare: 0.1,
    commonFpPool: 15,
    thinkMs: [500, 4000],
    confirmRate: 0.95,
    retry429: 3,
  },
  bots: {
    mix: null,
    s1: { cards: 5, hosts: 20, spanFraction: 0.15 },
    s2: { cards: 40, proxyPoolRatio: 0.5, retry429: 3 },
    s3: { cards: 10, ips: 10, codeSpam: 6, entrySpam: 10 },
    s4: { cards: 10, ips: 20, attempts: 15, fakeShare: 0.9 },
    s5: { cards: 3, retry429: 3 },
  },
  reveal: { maxRounds: 4, workerTickSeconds: 12 },
};

const MIXES = {
  S1: { s1: 1 },
  S2: { s2: 1 },
  S3: { s3: 1 },
  S4: { s4: 1 },
  S5: { s5: 1 },
  S6: { s1: 0.2, s2: 0.3, s3: 0.15, s4: 0.15, s5: 0.2 },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isObj(cur[keys[i]])) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

function parseValue(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function loadConfig(file, sets = [], env = process.env) {
  const raw = YAML.parse(fs.readFileSync(file, 'utf8')) || {};
  const cfg = merge(structuredClone(DEFAULTS), raw);

  for (const s of sets) {
    const i = s.indexOf('=');
    if (i < 1) throw new Error(`bad --set value: ${s}`);
    setPath(cfg, s.slice(0, i), parseValue(s.slice(i + 1)));
  }

  cfg.scenario = String(cfg.scenario).toUpperCase();
  if (cfg.scenario !== 'S0' && !MIXES[cfg.scenario]) {
    throw new Error(`unknown scenario ${cfg.scenario}`);
  }

  if (cfg.scenario === 'S0') {
    cfg.botSharePercent = 0;
    cfg.bots.mix = {};
  } else {
    if (!(cfg.botSharePercent > 0 && cfg.botSharePercent < 100)) {
      throw new Error('botSharePercent must be between 1 and 99');
    }
    if (cfg.scenario !== 'S6' || !cfg.bots.mix) cfg.bots.mix = MIXES[cfg.scenario];
  }

  const share = cfg.botSharePercent;
  cfg.botAccounts = share > 0 ? Math.round((cfg.honestUsers * share) / (100 - share)) : 0;

  cfg.baseUrl = env.BASE_URL || cfg.baseUrl;
  cfg.testKey = env.TEST_KEY;
  cfg.organiserEmail = env.ORGANISER_EMAIL;
  cfg.databaseUrl = env.DATABASE_URL;
  return cfg;
}
