import crypto from 'node:crypto';
import { solvePow, sidCookie } from './api.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errCode = (r) => r.body?.error?.code || `HTTP_${r.status}`;
const between = (lo, hi) => lo + Math.random() * (hi - lo);

function retryAfterMs(r) {
  const s = Number(r.headers['retry-after']);
  return Math.min(Number.isFinite(s) && s > 0 ? s * 1000 : 1000, 4000) + Math.random() * 300;
}

async function withRetry(times, fn) {
  let r = await fn();
  for (let i = 0; i < times && r.status === 429; i++) {
    await sleep(retryAfterMs(r));
    r = await fn();
  }
  return r;
}

async function getPow(ctx, u, purpose) {
  const ch = await ctx.api.req('GET', `/pow/challenge?purpose=${purpose}`, { user: u, tag: 'pow' });
  if (ch.status !== 200 || !ch.body?.prefix) return { pow: null, res: ch };
  const nonce = solvePow(ch.body.prefix, ch.body.difficulty);
  if (nonce === null) return { pow: null, res: { status: 0, body: null, headers: {}, ms: 0 } };
  return {
    pow: { challengeId: ch.body.challengeId, nonce: ctx.cfg.nonceAsNumber ? nonce : String(nonce) },
    res: ch,
  };
}

const otpRequest = (ctx, u, retries) =>
  withRetry(retries, async () => {
    const p = await getPow(ctx, u, 'otp');
    if (!p.pow) return p.res;
    return ctx.api.req('POST', '/auth/otp/request', {
      user: u,
      tag: 'otp_request',
      body: { email: u.email, pow: p.pow },
    });
  });

async function verify(ctx, u, code, retries) {
  const r = await withRetry(retries, () =>
    ctx.api.req('POST', '/auth/otp/verify', { user: u, tag: 'otp_verify', body: { email: u.email, code } })
  );
  if (r.status !== 200) return { ok: false, code: errCode(r) };
  u.cookie = sidCookie(r.headers['set-cookie']);
  return u.cookie ? { ok: true } : { ok: false, code: 'NO_COOKIE' };
}

export async function login(ctx, u, retries = 0) {
  const r = await otpRequest(ctx, u, retries);
  const code = r.body?.devCode;
  if (!code) return { ok: false, code: r.status === 202 || r.status === 200 ? 'NO_DEVCODE' : errCode(r) };
  return verify(ctx, u, code, retries);
}

// powOverride: undefined solves a real puzzle, null sends none, an object is sent as given
async function enterOnce(ctx, u, powOverride) {
  let pow = powOverride;
  if (pow === undefined) {
    const p = await getPow(ctx, u, 'entry');
    if (!p.pow) return p.res;
    pow = p.pow;
  }
  const body = { deviceFingerprint: u.fp };
  if (pow) body.pow = pow;
  const r = await ctx.api.req('POST', `/drops/${ctx.dropId}/entries`, { user: u, tag: 'entry', body });
  if (r.status === 201 && r.body?.entryId) u.entryId = r.body.entryId;
  return r;
}

async function recoverEntry(ctx, u) {
  const r = await ctx.api.req('GET', `/drops/${ctx.dropId}/entries/me`, { user: u, tag: 'recover' });
  if (r.body?.entryId) u.entryId = r.body.entryId;
}

async function enter(ctx, u, retries) {
  const r = await withRetry(retries, () => enterOnce(ctx, u));
  if (u.entryId) return { ok: true };
  const code = errCode(r);
  if (code === 'ALREADY_ENTERED') await recoverEntry(ctx, u);
  return { ok: !!u.entryId, code };
}

async function plain(ctx, u, retries, think) {
  if (think) await sleep(between(think[0], think[1]));
  const l = await login(ctx, u, retries);
  if (!l.ok) return `login_${l.code}`;
  if (think) await sleep(between(think[0], think[1]));
  const e = await enter(ctx, u, retries);
  return e.ok ? 'entered' : `entry_${e.code}`;
}

// S3: hammers code requests and entry submissions from a few IPs.
async function retrySpammer(ctx, u) {
  const p = ctx.cfg.bots.s3;
  await Promise.all(Array.from({ length: p.codeSpam }, () => otpRequest(ctx, u, 0)));
  const l = await login(ctx, u, 0);
  if (!l.ok) return `login_${l.code}`;
  await Promise.all(Array.from({ length: p.entrySpam }, () => enterOnce(ctx, u)));
  if (!u.entryId) await recoverEntry(ctx, u);
  return u.entryId ? 'entered' : 'entry_blocked';
}

// S4: floods with fake or missing puzzle answers, a few real ones slip in.
async function flooder(ctx, u) {
  const p = ctx.cfg.bots.s4;
  const fakePow = () => (Math.random() < 0.5 ? undefined : { challengeId: crypto.randomUUID(), nonce: '0' });

  let code = null;
  for (let a = 0; a < p.attempts && !code; a++) {
    let r;
    if (Math.random() < p.fakeShare) {
      const pow = fakePow();
      r = await ctx.api.req('POST', '/auth/otp/request', {
        user: u,
        tag: 'otp_request',
        body: pow ? { email: u.email, pow } : { email: u.email },
      });
    } else {
      r = await otpRequest(ctx, u, 0);
    }
    code = r.body?.devCode || null;
  }
  if (!code) return 'login_blocked';
  const v = await verify(ctx, u, code, 0);
  if (!v.ok) return `login_${v.code}`;

  for (let a = 0; a < p.attempts && !u.entryId; a++) {
    if (Math.random() < p.fakeShare) {
      await enterOnce(ctx, u, fakePow() ?? null);
    } else {
      await enterOnce(ctx, u);
    }
  }
  return u.entryId ? 'entered' : 'entry_blocked';
}

const handlers = {
  honest: (ctx, u) => plain(ctx, u, ctx.cfg.honest.retry429, ctx.cfg.honest.thinkMs),
  s1: (ctx, u) => plain(ctx, u, 0, null),
  s2: (ctx, u) => plain(ctx, u, u.retry429, [200, 1500]),
  s5: (ctx, u) => plain(ctx, u, u.retry429, [200, 1500]),
  s3: retrySpammer,
  s4: flooder,
};

export async function runUser(ctx, u) {
  let outcome;
  try {
    outcome = await handlers[u.type](ctx, u);
  } catch {
    outcome = 'exception';
  }
  const key = `${u.type}:${outcome}`;
  ctx.outcomes[key] = (ctx.outcomes[key] || 0) + 1;
}

export async function statusAndConfirm(ctx, u) {
  const r = await ctx.api.req('GET', `/drops/${ctx.dropId}/entries/me`, { user: u, tag: 'status' });
  if (r.status !== 200) return;
  if (r.body?.state === 'WON') {
    ctx.holders.add(u.entryId);
    await tryConfirm(ctx, u);
  }
}

export async function tryConfirm(ctx, u) {
  if (u.confirmTried || !u.willConfirm) return;
  u.confirmTried = true;
  const r = await ctx.api.req('POST', `/drops/${ctx.dropId}/entries/me/confirm`, {
    user: u,
    tag: 'confirm',
    body: { testCard: u.card, payerName: u.payerName },
  });
  const key = `${u.isBot ? 'bot' : 'honest'}:${r.status === 200 ? 'confirmed' : errCode(r)}`;
  ctx.confirmOutcomes[key] = (ctx.confirmOutcomes[key] || 0) + 1;
}
