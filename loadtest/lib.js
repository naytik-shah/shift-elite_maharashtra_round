import http from 'k6/http';
import { sha256 } from 'k6/crypto';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
export const API = `${BASE_URL}/api/v1`;
export const DROP_ID = __ENV.DROP_ID;
export const TEST_KEY = __ENV.TEST_KEY;

export const serverErrors = new Rate('server_errors');
export const errors5xx = new Counter('errors_5xx');
export const rateLimited = new Counter('rate_limited_requests');
export const clientErrors = new Counter('client_errors');

export const summaryTrendStats = ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'];

export function requireEnv() {
  if (!TEST_KEY || !DROP_ID) {
    throw new Error('Set TEST_KEY and DROP_ID with -e');
  }
}

export function headersFor(ip, extra) {
  return Object.assign(
    {
      'Content-Type': 'application/json',
      'X-Test-Key': TEST_KEY,
      'X-Test-Client-IP': ip,
    },
    extra || {}
  );
}

// Consecutive users land in different /24 subnets, so no single bucket fills up.
export function ipFor(i) {
  return `10.${(i >> 8) & 255}.${i & 255}.${((i >> 16) & 255) + 1}`;
}

export function randomFp() {
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export function get(path, ip, step, extraHeaders) {
  return http.get(`${API}${path}`, {
    headers: headersFor(ip, extraHeaders),
    tags: { step },
  });
}

export function post(path, body, ip, step, extraHeaders) {
  return http.post(`${API}${path}`, JSON.stringify(body), {
    headers: headersFor(ip, extraHeaders),
    tags: { step },
  });
}

// 5xx and network failures count as errors. 429 is counted separately as intended.
export function track(res, name) {
  if (res.status === 429) {
    rateLimited.add(1);
    return false;
  }
  if (res.status >= 500 || res.status === 0) {
    errors5xx.add(1);
    serverErrors.add(true);
    return false;
  }
  serverErrors.add(false);
  const ok = res.status >= 200 && res.status < 300;
  if (!ok) clientErrors.add(1, { step: name });
  check(res, { [`${name} ok`]: () => ok });
  return ok;
}

function zeroBits(hex) {
  let bits = 0;
  for (let i = 0; i < hex.length; i++) {
    const v = parseInt(hex[i], 16);
    if (v === 0) {
      bits += 4;
      continue;
    }
    return bits + Math.clz32(v) - 28;
  }
  return bits;
}

// Must match how the server checks it: sha256(prefix + nonce), leading zero bits.
export function solvePow(ch, maxTries) {
  const limit = maxTries || 2000000;
  for (let n = 0; n < limit; n++) {
    if (zeroBits(sha256(ch.prefix + n, 'hex')) >= ch.difficulty) {
      return { challengeId: ch.challengeId, nonce: String(n) };
    }
  }
  return null;
}

// Ramp up, hold, ramp down. Area under the curve is about `total` iterations.
export function burstStages(total, durationS) {
  const peak = Math.max(1, Math.ceil(total / (0.8 * durationS)));
  return [
    { target: peak, duration: `${Math.round(durationS * 0.2)}s` },
    { target: peak, duration: `${Math.round(durationS * 0.6)}s` },
    { target: 0, duration: `${Math.round(durationS * 0.2)}s` },
  ];
}

// Reads lines like: SESSION {"sid":"...","ip":"..."}
export function parseSessions(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].indexOf('{');
    if (at < 0) continue;
    try {
      const s = JSON.parse(lines[i].slice(at));
      if (s.sid && s.ip) out.push(s);
    } catch (e) {
      // not a session line
    }
  }
  return out;
}
