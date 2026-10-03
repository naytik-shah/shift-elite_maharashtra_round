import { pool } from '../db.js';
import { redis } from '../redis.js';

const COLS = `id, name, seats, state, window_opens_at, window_closes_at, draw_at, confirm_window_min,
              ticket_price, seed_commit, category, venue, city, description, event_at`;

export function formatDrop(r) {
  const out = {
    id: r.id,
    name: r.name,
    seats: r.seats,
    state: r.state,
    windowOpensAt: new Date(r.window_opens_at).toISOString(),
    windowClosesAt: new Date(r.window_closes_at).toISOString(),
    drawAt: new Date(r.draw_at).toISOString(),
    confirmWindowMinutes: r.confirm_window_min,
    ticketPrice: r.ticket_price,
    seedCommit: r.seed_commit,
  };
  if (r.category) out.category = r.category;
  if (r.venue) out.venue = r.venue;
  if (r.city) out.city = r.city;
  if (r.description) out.description = r.description;
  if (r.event_at) out.eventAt = new Date(r.event_at).toISOString();
  return out;
}

const dropKey = (id) => `cache:drop:${id}`;

// Drop details, held in Redis for 5 seconds.
export async function getDropCached(dropId) {
  try {
    const hit = await redis.get(dropKey(dropId));
    if (hit) return hit === 'null' ? null : JSON.parse(hit);
  } catch { /* cache is optional */ }
  const { rows } = await pool.query(`SELECT ${COLS} FROM drops WHERE id = $1`, [dropId]);
  const drop = rows[0] ? formatDrop(rows[0]) : null;
  redis.set(dropKey(dropId), drop ? JSON.stringify(drop) : 'null', 'EX', drop ? 5 : 2).catch(() => {});
  return drop;
}

export async function listDropsCached() {
  try {
    const hit = await redis.get('cache:drops');
    if (hit) return JSON.parse(hit);
  } catch { /* cache is optional */ }
  const { rows } = await pool.query(`SELECT ${COLS} FROM drops ORDER BY window_opens_at, id`);
  const drops = rows.map(formatDrop);
  redis.set('cache:drops', JSON.stringify(drops), 'EX', 5).catch(() => {});
  return drops;
}

export function invalidateDrop(dropId) {
  return redis.del(dropKey(dropId), 'cache:drops').catch(() => {});
}

// What the public sees after the draw. Cached forever once the draw has happened.
export async function getDrawPublic(dropId) {
  const ck = `cache:draw:${dropId}`;
  try {
    const hit = await redis.get(ck);
    if (hit) return JSON.parse(hit);
  } catch { /* cache is optional */ }
  const { rows } = await pool.query('SELECT seed_commit, seed_revealed, manifest_hash FROM drops WHERE id = $1', [dropId]);
  if (!rows[0]) return null;
  const out = {
    seedCommit: rows[0].seed_commit,
    seed: rows[0].seed_revealed,
    manifestHash: rows[0].manifest_hash,
    algorithm: 'es-weighted-v1',
  };
  if (out.manifestHash) redis.set(ck, JSON.stringify(out)).catch(() => {});
  return out;
}
