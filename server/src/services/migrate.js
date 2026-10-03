import fs from 'node:fs/promises';
import { pool } from '../db.js';
import logger from '../logger.js';

const dir = new URL('../../migrations/', import.meta.url);

// Applies any .sql file in /migrations that is not yet recorded, in name order.
// An advisory lock makes this safe when several processes start together.
export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(1)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await fs.readFile(new URL(file, dir), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info({ file }, 'migration applied');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(1)'); } catch { /* connection is closing anyway */ }
    client.release();
  }
}
