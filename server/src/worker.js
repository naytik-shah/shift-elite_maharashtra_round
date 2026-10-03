import config, { assertConfig } from './config.js';
import logger from './logger.js';
import { pool } from './db.js';
import { closeRedis } from './redis.js';
import { migrate } from './services/migrate.js';
import { runTick } from './services/waitlist.js';
import { startMailConsumers } from './services/mailer.js';

process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled promise rejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception, exiting so the container restarts');
  process.exit(1);
});

assertConfig();
await migrate();

let stopping = false;
const mailLoops = startMailConsumers(() => stopping);

async function loop() {
  while (!stopping) {
    const started = Date.now();
    try {
      const r = await runTick();
      if (r && !r.skipped && (r.expired || r.completed)) logger.info(r, 'worker tick');
    } catch (err) {
      logger.error({ err: err.message }, 'worker tick failed, will retry');
    }
    const wait = Math.max(200, config.workerIntervalMs - (Date.now() - started));
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

logger.info({ intervalMs: config.workerIntervalMs }, 'worker started');
const main = loop();

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'worker stopping');
  setTimeout(() => process.exit(0), 8000).unref();
  await Promise.allSettled([main, mailLoops]);
  await pool.end().catch(() => {});
  await closeRedis();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
