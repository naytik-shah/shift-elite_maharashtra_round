// Request helpers and per-user flows for the load test. Used by the main thread and by the worker
// threads (each thread has its own copy of the counters, which the main thread merges).
import crypto from 'node:crypto';
import { TEST_KEY, sleep, solveNonce } from './lib.mjs';

const BASES = (process.env.BASE_URLS || process.env.BASE_URL || 'http://localhost:3000/api/v1').split(',');
export const lat = new Map(); // label -> [ms]
export const codes = new Map(); // label -> { outcome -> count }

export function rec(label, ms, key) {
  if (!lat.has(label)) { lat.set(label, []); codes.set(label, {}); }
  lat.get(label).push(ms);
  const c = codes.get(label);
  c[key] = (c[key] || 0) + 1;
}

export const snapshot = () => ({ lat: [...lat], codes: [...codes] });
export function mergeSnapshot(into, snap) {
  for (const [label, arr] of snap.lat) {
    if (!into.lat.has(label)) { into.lat.set(label, []); into.codes.set(label, {}); }
    const dst = into.lat.get(label);
    for (const v of arr) dst.push(v);
  }
  for (const [label, c] of snap.codes) {
    const dst = into.codes.get(label);
    for (const [k, v] of Object.entries(c)) dst[k] = (dst[k] || 0) + v;
  }
}

let rr = Math.floor(Math.random() * 1000);
export const nextBase = () => BASES[rr++ % BASES.length];

export async function call(label, method, path, { cookie, body, ip, retries = 0 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const h = { 'Content-Type': 'application/json', 'X-Test-Key': TEST_KEY };
    if (method !== 'GET') h['Idempotency-Key'] = crypto.randomUUID();
    if (cookie) h.Cookie = cookie;
    if (ip) h['X-Test-Client-IP'] = ip;
    const t0 = performance.now();
    let res;
    let text = '';
    try {
      res = await fetch(nextBase() + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
      text = await res.text();
    } catch (err) {
      rec(label, performance.now() - t0, `NETWORK:${err.cause?.code || err.message}`);
      if (attempt < retries) { await sleep(200 * (attempt + 1)); continue; }
      return { status: 0, data: null };
    }
    const ms = performance.now() - t0;
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not json */ }
    rec(label, ms, res.status >= 400 ? `${res.status}:${data?.error?.code ?? '?'}` : String(res.status));
    if (res.status >= 500 || res.status === 429) {
      if (attempt < retries) {
        const ra = Number(res.headers.get('retry-after')) || 1;
        await sleep(Math.min(ra, 3) * 300 + Math.random() * 300);
        continue;
      }
    }
    const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    return { status: res.status, data, cookie: sc.map((c) => c.split(';')[0]).find((c) => c.startsWith('sid=')) };
  }
}

export async function pool(items, fn, conc) {
  let next = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

export async function solve(u, purpose) {
  const ch = await call(`challenge(${purpose})`, 'GET', `/pow/challenge?purpose=${purpose}`, { ip: u.ip, retries: 4 });
  if (ch.status !== 200) return null;
  return { challengeId: ch.data.challengeId, nonce: solveNonce(ch.data.prefix, ch.data.difficulty) };
}

// One user's whole sign-up: puzzle, code, login, puzzle, entry.
export async function signupFlow(u, drop) {
  const pow = await solve(u, 'otp');
  if (pow) {
    const rq = await call('otp/request', 'POST', '/auth/otp/request', { body: { email: u.email, pow }, ip: u.ip, retries: 4 });
    if (rq.data?.devCode) {
      const v = await call('otp/verify', 'POST', '/auth/otp/verify', { body: { email: u.email, code: rq.data.devCode }, ip: u.ip, retries: 4 });
      if (v.status === 200) { u.cookie = v.cookie; u.id = v.data.user.id; }
    }
  }
  if (u.cookie) {
    const pow2 = await solve(u, 'entry');
    if (pow2) {
      const e = await call('entry', 'POST', `/drops/${drop}/entries`, {
        cookie: u.cookie, ip: u.ip, body: { pow: pow2, deviceFingerprint: crypto.randomBytes(8).toString('hex') }, retries: 4,
      });
      u.entered = e.status === 201;
    }
  }
  return u;
}

export async function statusFlow(u, drop) {
  const r = await call('status', 'GET', `/drops/${drop}/entries/me`, { cookie: u.cookie, ip: u.ip, retries: 3 });
  u.statusCode = r.status;
  u.status = r.status === 200 ? r.data : null;
  return u;
}

export async function confirmFlow(u, drop, label, card, name) {
  const r = await call(label, 'POST', `/drops/${drop}/entries/me/confirm`, {
    cookie: u.cookie, ip: u.ip, body: { testCard: card, payerName: name }, retries: 2,
  });
  u.confirmStatus = r.status;
  u.confirmCode = r.data?.error?.code ?? null;
  return u;
}
