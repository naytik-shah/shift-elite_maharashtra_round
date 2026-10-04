import express from 'express';
import { pool } from './db.js';
import { redis } from './redis.js';
import { loadSession } from './middleware/session.js';
import { Errors } from './lib/errors.js';
import { requestLog } from './middleware/requestLog.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { clientIp } from './middleware/clientIp.js';
import { testAccess } from './middleware/testAccess.js';
import { requestLimits } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import authRoutes from './routes/auth.js';
import dropRoutes from './routes/drops.js';
import entryRoutes from './routes/entries.js';
import adminRoutes from './routes/admin.js';
import demoRoutes from './routes/demo.js';

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const isWrite = (req) => req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(requestLog);
  app.use(securityHeaders);

  const api = express.Router();

  // Health check: no session, no rate limit. Used by the load balancer and by us.
  api.get('/health', async (_req, res) => {
    const out = { ok: true, db: true, redis: true };
    await Promise.all([
      withTimeout(pool.query('SELECT 1'), 1500).catch(() => { out.db = false; }),
      withTimeout(redis.ping(), 1500).catch(() => { out.redis = false; }),
    ]);
    out.ok = out.db && out.redis;
    res.status(out.ok ? 200 : 503).set('Cache-Control', 'no-store').json(out);
  });

  // Who is asking, then (after the session below) how often, before any real work.
  api.use(clientIp);
  api.use(testAccess);

  // Load the session (one Redis read) only when the request carries a session cookie.
  api.use(loadSession);
  api.use(requestLimits);

  // Cross-site forms cannot send JSON, so requiring it on every write blocks forged requests.
  api.use((req, _res, next) => {
    if (isWrite(req) && !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      return next(Errors.validation('Content-Type must be application/json.'));
    }
    next();
  });
  const jsonBody = express.json({ limit: '16kb' });
  api.use((req, res, next) => (isWrite(req) ? jsonBody(req, res, next) : next()));

  api.use(authRoutes);
  api.use(dropRoutes);
  api.use(entryRoutes);
  api.use(adminRoutes);
  api.use(demoRoutes);

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
