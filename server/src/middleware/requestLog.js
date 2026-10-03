import crypto from 'node:crypto';
import logger from '../logger.js';

// Light request logging. A request id on every response, and a log line only when something is
// worth reading: a server error, or a request that took over 2 seconds. Ordinary client errors
// (401, 404, 409, 429) are expected business outcomes and stay out of the logs, so an attack that
// produces thousands of them cannot flood the disk or slow the server down.
const prefix = crypto.randomBytes(3).toString('hex');
let seq = 0;

export function requestLog(req, res, next) {
  const id = `${prefix}-${(++seq).toString(36)}`;
  req.id = id;
  res.setHeader('X-Request-Id', id);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (res.statusCode >= 500) {
      logger.error({ id, method: req.method, url: req.originalUrl, status: res.statusCode, ms: Math.round(ms) }, 'request failed');
    } else if (ms > 2000) {
      logger.warn({ id, method: req.method, url: req.originalUrl, status: res.statusCode, ms: Math.round(ms) }, 'slow request');
    } else if (logger.isLevelEnabled('debug')) {
      logger.debug({ id, method: req.method, url: req.originalUrl, status: res.statusCode, ms: Math.round(ms) }, 'request');
    }
  });
  next();
}
