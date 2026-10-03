import { pool } from '../db.js';

// A person's status is read from Postgres (the truth). To keep the reveal burst cheap, each API process
// also remembers answers for a moment in its own memory (no network call at all). The memory is cleared
// the moment something changes: a draw or completion bumps a per-drop version, and a confirm, expiry or
// promotion clears that one person. Both reach every process through the Redis pub/sub events.
const TTL_MS = 1500;
const MAX_ENTRIES = 150_000;

const cache = new Map(); // `${dropId}:${userId}` -> { s, exp, ver }
const versions = new Map(); // dropId -> number

const verOf = (dropId) => versions.get(dropId) || 0;

export function bumpStatusVersion(dropId) {
  versions.set(dropId, verOf(dropId) + 1);
}

export function invalidateStatus(dropId, userId) {
  cache.delete(`${dropId}:${userId}`);
}

function shape(r) {
  return {
    entryId: r.entry_id,
    state: r.state,
    rank: r.rank,
    // Waitlisted entries leave the list strictly in rank order, so position = rank - cursor.
    waitlistPosition: r.state === 'WAITLISTED' && r.rank != null ? r.rank - r.cursor_rank : null,
    confirmBy: r.state === 'WON' && r.confirm_by ? new Date(r.confirm_by).toISOString() : null,
  };
}

const SELECT = `
  SELECT e.id AS entry_id, e.user_id, e.state, e.rank, d.cursor_rank, s.confirm_by
  FROM entries e
  JOIN drops d ON d.id = e.drop_id
  LEFT JOIN seat_slots s ON s.drop_id = e.drop_id AND s.entry_id = e.id AND s.state = 'PENDING'`;

export async function getMyStatus(dropId, userId) {
  const k = `${dropId}:${userId}`;
  const hit = cache.get(k);
  const ver = verOf(dropId);
  if (hit && hit.exp > Date.now() && hit.ver === ver) return hit.s;

  const { rows } = await pool.query(`${SELECT} WHERE e.drop_id = $1 AND e.user_id = $2`, [dropId, userId]);
  const status = rows[0] ? shape(rows[0]) : null;
  // "Not entered" is never remembered, so a new entry shows up on the very next read from any process.
  if (status) {
    if (cache.size >= MAX_ENTRIES) cache.clear();
    cache.set(k, { s: status, exp: Date.now() + TTL_MS, ver });
  }
  return status;
}

// Fresh (uncached) statuses for many users, used when fanning out a draw result over SSE.
export async function getStatusesBatch(dropId, userIds) {
  const out = new Map();
  if (!userIds.length) return out;
  const { rows } = await pool.query(`${SELECT} WHERE e.drop_id = $1 AND e.user_id = ANY($2::uuid[])`, [dropId, userIds]);
  for (const r of rows) out.set(r.user_id, shape(r));
  return out;
}
