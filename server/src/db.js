import pg from 'pg';
import config from './config.js';
import logger from './logger.js';

// bigint columns (audit seq, counts) come back as numbers, not strings.
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  connectionTimeoutMillis: config.dbAcquireTimeoutMs,
  idleTimeoutMillis: 30_000,
  // A request can never pin a connection forever, even if a bug leaves a transaction open.
  statement_timeout: 30_000,
  idle_in_transaction_session_timeout: 30_000,
});

pool.on('error', (err) => logger.error({ err }, 'idle postgres client error'));

export const query = (text, params) => pool.query(text, params);

// Runs fn inside BEGIN/COMMIT on one connection. Rolls back on any error.
export async function withTx(fn, existingClient) {
  const client = existingClient || (await pool.connect());
  let broken = false;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      broken = true;
      logger.error({ err: rollbackErr }, 'rollback failed, discarding connection');
    }
    throw err;
  } finally {
    if (!existingClient) client.release(broken);
  }
}

// Errors that mean "the database is overloaded or briefly unavailable", not "we have a bug".
export function isDbBusy(err) {
  if (!err) return false;
  const text = `${err.message || ''} ${err.code || ''}`;
  if (/timeout exceeded when trying to connect|Connection terminated|Client has encountered a connection error|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ETIMEDOUT|EPIPE|terminating connection|starting up|shutting down|too many clients/i.test(text)) return true;
  // 57014 query cancelled, 40001/40P01 serialization or deadlock, 53300 too many connections,
  // 57P01-57P03 server shutting down or starting, 08xxx connection problems, 55P03 lock not available
  return ['57014', '40001', '40P01', '53300', '57P01', '57P02', '57P03', '08006', '08003', '08001', '08004', '55P03'].includes(err.code);
}

export const isUniqueViolation = (err, constraint) =>
  err && err.code === '23505' && (!constraint || err.constraint === constraint);
