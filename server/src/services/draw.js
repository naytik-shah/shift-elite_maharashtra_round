import { pool, withTx } from '../db.js';
import { redis } from '../redis.js';
import { Errors } from '../lib/errors.js';
import { appendAudit } from './audit.js';
import { buildManifest, rankEntries } from './drawAlgo.js';
import { invalidateDrop } from './dropsRepo.js';
import { bumpStatusVersion } from './status.js';
import { publishDropEvent } from './events.js';
import { enqueueMail, mailTemplates } from './mailer.js';

async function dropExists(client, dropId) {
  const r = await client.query('SELECT 1 FROM drops WHERE id = $1', [dropId]);
  return r.rowCount > 0;
}

// Closes entries. Takes a row lock so every in-flight entry finishes first and none can commit after.
export async function closeDrop(dropId) {
  const entries = await withTx(async (c) => {
    const lock = await c.query('SELECT id FROM drops WHERE id = $1 FOR UPDATE', [dropId]);
    if (!lock.rowCount) throw Errors.notFound('Drop not found.');
    const upd = await c.query("UPDATE drops SET state = 'CLOSED' WHERE id = $1 AND state = 'OPEN' RETURNING id", [dropId]);
    if (!upd.rowCount) throw Errors.invalidState('Entries are already closed.');
    const n = (await c.query('SELECT COUNT(*)::int AS n FROM entries WHERE drop_id = $1', [dropId])).rows[0].n;
    await appendAudit(c, dropId, 'CLOSED', { dropId, entries: n });
    return n;
  });
  await invalidateDrop(dropId);
  await publishDropEvent(dropId, { type: 'drop_state', state: 'CLOSED' });
  return { state: 'CLOSED', entries };
}

// The draw (MVP.md section 6). Runs once: the first statement only matches a CLOSED drop.
export async function runDraw(dropId) {
  const out = await withTx(async (c) => {
    await c.query("SET LOCAL statement_timeout = '120s'");
    const upd = await c.query(
      `UPDATE drops SET state = 'DRAWN'
       WHERE id = $1 AND state = 'CLOSED' AND (scoring_started_at IS NULL OR scored_at IS NOT NULL)
       RETURNING seats, confirm_window_min`,
      [dropId],
    );
    if (!upd.rowCount) {
      if (!(await dropExists(c, dropId))) throw Errors.notFound('Drop not found.');
      throw Errors.invalidState('The draw can only run once, after entries are closed (and scoring has finished).');
    }
    const { seats, confirm_window_min: windowMin } = upd.rows[0];

    const seedRow = await c.query('SELECT seed FROM drop_secrets WHERE drop_id = $1', [dropId]);
    if (!seedRow.rowCount) throw new Error(`No seed stored for drop ${dropId}`);
    const seed = seedRow.rows[0].seed;

    const entryRows = await c.query("SELECT id, weight FROM entries WHERE drop_id = $1 AND state = 'ENTERED'", [dropId]);
    const manifest = buildManifest(entryRows.rows);
    const ranking = rankEntries(seed, manifest.entries);

    if (ranking.length) {
      const ranks = ranking.map((_, i) => i + 1);
      await c.query(
        `UPDATE entries e SET rank = r.rank,
                state = CASE WHEN r.rank <= $1 THEN 'WON' ELSE 'WAITLISTED' END
         FROM unnest($2::uuid[], $3::int[]) AS r(id, rank)
         WHERE e.id = r.id AND e.state = 'ENTERED'`,
        [seats, ranking, ranks],
      );
      await c.query(
        `INSERT INTO seat_slots (drop_id, slot_no, entry_id, confirm_by)
         SELECT drop_id, rank, id, now() + ($2::int * interval '1 minute')
         FROM entries WHERE drop_id = $1 AND state = 'WON'`,
        [dropId, windowMin],
      );
    }
    await c.query(
      'UPDATE drops SET manifest_hash = $2, seed_revealed = $3, cursor_rank = $4 WHERE id = $1',
      [dropId, manifest.hash, seed, seats],
    );
    const winners = Math.min(seats, ranking.length);
    await appendAudit(c, dropId, 'DRAWN', { dropId, seed, manifestHash: manifest.hash, entries: ranking.length, winners });
    return { seed, manifestHash: manifest.hash, manifest, ranking, seats, windowMin };
  });

  // Everything below is after the commit: caching, live updates and emails never block the draw.
  try {
    await Promise.all([
      redis.set(`cache:manifest:${dropId}`, JSON.stringify({ entries: out.manifest.entries })),
      redis.set(`cache:results:${dropId}`, JSON.stringify({ ranking: out.ranking, seats: out.seats })),
      invalidateDrop(dropId),
    ]);
  } catch { /* caches are rebuilt from Postgres on demand */ }

  await bumpStatusVersion(dropId);
  await publishDropEvent(dropId, { type: 'drop_state', state: 'DRAWN' });
  await publishDropEvent(dropId, { type: 'manifest_published', manifestHash: out.manifestHash });
  await publishDropEvent(dropId, { type: 'draw_complete', seed: out.seed });
  queueWinEmails(dropId).catch(() => {});

  return { seed: out.seed, manifestHash: out.manifestHash };
}

async function queueWinEmails(dropId) {
  const { rows } = await pool.query(
    `SELECT u.email, s.confirm_by, d.name, d.confirm_window_min
     FROM seat_slots s
     JOIN entries e ON e.id = s.entry_id
     JOIN users u ON u.id = e.user_id
     JOIN drops d ON d.id = s.drop_id
     WHERE s.drop_id = $1 AND s.state = 'PENDING'`,
    [dropId],
  );
  for (const r of rows) {
    const t = mailTemplates.won(r.name, dropId, new Date(r.confirm_by), r.confirm_window_min);
    await enqueueMail({ to: r.email, ...t });
  }
}

export async function getManifest(dropId) {
  try {
    const hit = await redis.get(`cache:manifest:${dropId}`);
    if (hit) return JSON.parse(hit);
  } catch { /* fall back to Postgres */ }
  const { rows } = await pool.query(
    "SELECT id, weight FROM entries WHERE drop_id = $1 AND rank IS NOT NULL", [dropId],
  );
  const { entries } = buildManifest(rows);
  const out = { entries };
  redis.set(`cache:manifest:${dropId}`, JSON.stringify(out)).catch(() => {});
  return out;
}

export async function getResults(dropId) {
  try {
    const hit = await redis.get(`cache:results:${dropId}`);
    if (hit) return JSON.parse(hit);
  } catch { /* fall back to Postgres */ }
  const [{ rows }, drop] = await Promise.all([
    pool.query('SELECT id FROM entries WHERE drop_id = $1 AND rank IS NOT NULL ORDER BY rank', [dropId]),
    pool.query('SELECT seats FROM drops WHERE id = $1', [dropId]),
  ]);
  const out = { ranking: rows.map((r) => r.id), seats: drop.rows[0]?.seats ?? 0 };
  redis.set(`cache:results:${dropId}`, JSON.stringify(out)).catch(() => {});
  return out;
}
