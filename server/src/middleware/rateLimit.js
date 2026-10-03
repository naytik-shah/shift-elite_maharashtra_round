import config from '../config.js';
import logger from '../logger.js';
import { redis } from '../redis.js';
import { Errors } from '../lib/errors.js';
import { countRateLimited } from '../services/stats.js';

let lastWarn = 0;

// Takes one point from each limit in a single Redis round trip. limits: [name, limit, windowSec, key].
// Over any limit: 429 with Retry-After. If Redis is down: writes are refused (fail closed),
// reads carry on (fail open).
export async function takeMany(limits, { failClosed = false } = {}) {
  if (!config.rateLimitsEnabled) return;
  let waitMs = 0;
  try {
    const keys = limits.map(([name, , , key]) => `rl:${name}:${key}`);
    const pairs = limits.flatMap(([, limit, win]) => [limit, win]);
    waitMs = Number(await redis.rlTake(limits.length, ...keys, ...pairs));
  } catch (err) {
    const now = Date.now();
    if (now - lastWarn > 5000) {
      lastWarn = now;
      logger.warn({ err: err.message }, 'rate limiter unavailable');
    }
    if (failClosed) throw Errors.busy();
    return;
  }
  if (waitMs > 0) {
    countRateLimited();
    throw Errors.rateLimited(waitMs / 1000);
  }
}

export const take = (name, limit, windowSec, key, opts) => takeMany([[name, limit, windowSec, key]], opts);

const L = config.limits;

// The per-person limit that applies to this particular request, if any (PRD 9.4).
function userLimitFor(req) {
  const p = req.path;
  if (req.method === 'GET') {
    if (p.endsWith('/entries/me') || p.endsWith('/events')) return ['status_sess', L.sessionStatusPerMin, 60];
  } else if (req.method === 'POST') {
    if (p.endsWith('/entries/me/confirm')) return ['confirm_sess', L.sessionConfirmPerMin, 60];
    if (/^\/drops\/[^/]+\/entries$/.test(p)) return ['entry_sess', L.sessionEntryPerMin, 60];
  }
  return null;
}

// Runs on every API request (except health) after the session is known: per IP, per /24 subnet and,
// for signed-in people, the limit for what they are doing. All checked in one Redis round trip.
export async function requestLimits(req, _res, next) {
  try {
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    const limits = [['ip', L.ipAllPerMin, 60, req.clientIp], ['subnet', L.subnetAllPerMin, 60, req.subnet]];
    const userId = req.session && req.session.userId;
    if (userId) {
      const u = userLimitFor(req);
      if (u) limits.push([u[0], u[1], u[2], userId]);
    }
    await takeMany(limits, { failClosed: write });
    next();
  } catch (err) {
    next(err);
  }
}

export const limitOtpRequestIp = (req) => take('otpreq_ip', L.ipOtpRequest, 600, req.clientIp, { failClosed: true });
export const limitOtpRequestEmail = (email) => take('otpreq_email', L.emailOtpRequest, 600, email, { failClosed: true });
export const limitOtpVerifyIp = (req) => take('otpver_ip', L.ipOtpVerify, 600, req.clientIp, { failClosed: true });
