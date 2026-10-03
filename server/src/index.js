import http from 'node:http';
import config, { assertConfig } from './config.js';
import logger from './logger.js';
import { pool } from './db.js';
import { closeRedis } from './redis.js';
import { createApp } from './app.js';
import { migrate } from './services/migrate.js';
import { loadDrops, loadDisposableDomains } from './services/dropsLoader.js';
import { startEventHub, closeAllConnections } from './services/events.js';

process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled promise rejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception, exiting so the container restarts');
  process.exit(1);
});

assertConfig();
await migrate();
const summary = await loadDrops();
await loadDisposableDomains();
await startEventHub();

const server = http.createServer(createApp());
// Longer than nginx's upstream keepalive, so the proxy never reuses a connection we just closed.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 30_000;
server.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port, ...summary, testAccess: Boolean(config.testKey) }, 'api listening');
});

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutting down');
  closeAllConnections();
  server.close();
  setTimeout(() => process.exit(0), 8000).unref();
  await pool.end().catch(() => {});
  await closeRedis();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
