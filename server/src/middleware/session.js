import crypto from 'node:crypto';
import config from '../config.js';
import { redis } from '../redis.js';
import { Errors } from '../lib/errors.js';

// Server-side sessions. The cookie holds only a random 256-bit id (nothing to sign or decode); the
// data lives in Redis under that id. A new id is made at every login, which stops session fixation.
const COOKIE = 'sid';
const TTL_SEC = 7 * 24 * 3600;
const ID_RE = /^[A-Za-z0-9_-]{43}$/;

function cookieFrom(header) {
  const i = header.indexOf(`${COOKIE}=`);
  if (i < 0) return null;
  if (i > 0 && header[i - 1] !== ' ' && header[i - 1] !== ';') return null;
  const end = header.indexOf(';', i);
  return header.slice(i + COOKIE.length + 1, end < 0 ? undefined : end);
}

const cookieAttrs = () => `Path=/; HttpOnly; SameSite=Lax${config.cookieSecure ? '; Secure' : ''}`;

// Loads the session if the request carries a valid cookie. Never fails the request by itself: if
// Redis is down the problem is remembered and only requests that need a login are turned away.
export async function loadSession(req, _res, next) {
  const header = req.headers.cookie;
  if (header) {
    const sid = cookieFrom(header);
    if (sid && ID_RE.test(sid)) {
      try {
        const raw = await redis.get(`sess:${sid}`);
        if (raw) {
          req.session = JSON.parse(raw);
          req.sessionId = sid;
        }
      } catch (err) {
        req.sessionError = err;
      }
    }
  }
  next();
}

export async function createSession(req, res, data) {
  const sid = crypto.randomBytes(32).toString('base64url');
  await redis.set(`sess:${sid}`, JSON.stringify(data), 'EX', TTL_SEC);
  // The old session (if the browser sent one) must not stay usable.
  if (req.sessionId) await redis.del(`sess:${req.sessionId}`).catch(() => {});
  res.append('Set-Cookie', `${COOKIE}=${sid}; ${cookieAttrs()}; Max-Age=${TTL_SEC}`);
  req.session = data;
  req.sessionId = sid;
}

export async function destroySession(req, res) {
  if (req.sessionId) await redis.del(`sess:${req.sessionId}`).catch(() => {});
  res.append('Set-Cookie', `${COOKIE}=; ${cookieAttrs()}; Max-Age=0`);
  req.session = undefined;
  req.sessionId = undefined;
}

export function requireSession(req) {
  if (req.sessionError) throw Errors.busy();
  if (!req.session || !req.session.userId) throw Errors.unauthenticated();
}
