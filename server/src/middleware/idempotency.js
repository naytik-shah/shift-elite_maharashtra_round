import { redis } from '../redis.js';
import { sha256 } from '../lib/hash.js';
import { Errors } from '../lib/errors.js';
import logger from '../logger.js';

const RUNNING_TTL = 30;
const DONE_TTL = 24 * 3600;

// Repeating a request with the same Idempotency-Key returns the first answer instead of running it again.
// Without the header the request just runs; the database constraints still keep everything correct.
export async function idempotency(req, res, next) {
  const header = req.headers['idempotency-key'];
  if (typeof header !== 'string' || !header || header.length > 128) return next();

  const scope = req.session?.userId || req.clientIp;
  const key = `idem:${scope}:${req.baseUrl}${req.path}:${header}`;
  const bodyHash = sha256(JSON.stringify(req.body ?? {}));

  try {
    const claimed = await redis.set(key, JSON.stringify({ state: 'running', bodyHash }), 'EX', RUNNING_TTL, 'NX');
    if (!claimed) {
      const raw = await redis.get(key);
      const saved = raw ? JSON.parse(raw) : null;
      if (!saved) return next(); // it expired between the two calls, run it normally
      if (saved.bodyHash !== bodyHash) return next(Errors.idempotencyMismatch());
      if (saved.state === 'running') return next(Errors.busy(1));
      res.set('Idempotent-Replay', 'true');
      return res.status(saved.status).json(saved.body);
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'idempotency store unavailable, continuing without it');
    return next();
  }

  // Remember the answer. Server errors and rate limits are not remembered, so a retry can succeed.
  let saved = false;
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 500 && res.statusCode !== 429 && res.statusCode !== 503) {
      saved = true;
      redis.set(key, JSON.stringify({ state: 'done', status: res.statusCode, body, bodyHash }), 'EX', DONE_TTL).catch(() => {});
    }
    return origJson(body);
  };
  res.on('finish', () => {
    if (!saved) redis.del(key).catch(() => {});
  });
  next();
}
