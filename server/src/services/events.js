import logger from '../logger.js';
import { pool } from '../db.js';
import { pub, sub } from '../redis.js';
import { getStatusesBatch, bumpStatusVersion, invalidateStatus } from './status.js';

// Live updates over SSE. Every API process keeps its own open connections and listens to Redis
// pub/sub, so a change made by any process (or the worker) reaches every connected browser.

const byDrop = new Map(); // dropId -> Set<conn>
const HEARTBEAT_MS = 20_000;
let connectionCount = 0;
let heartbeatTimer = null;

export const publishDropEvent = (dropId, event) =>
  pub.publish(`drop:${dropId}`, JSON.stringify(event)).catch((err) => logger.warn({ err: err.message }, 'publish failed'));

export const publishUserEvent = (userId, dropId, event) =>
  pub.publish(`user:${userId}`, JSON.stringify({ ...event, dropId })).catch((err) => logger.warn({ err: err.message }, 'publish failed'));

function write(conn, name, data) {
  if (conn.res.writableEnded || conn.res.destroyed) return false;
  // A client that stopped reading must not make us buffer without limit.
  if (conn.res.writableLength > 64 * 1024) {
    conn.res.destroy();
    return false;
  }
  conn.res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  return true;
}

const MAX_STREAMS_PER_USER = 5;
const perUser = new Map(); // `${dropId}:${userId}` -> open streams

// Returns null if this user already has too many streams open for the drop.
export function addConnection(dropId, userId, res) {
  const uk = `${dropId}:${userId}`;
  const open = perUser.get(uk) || 0;
  if (open >= MAX_STREAMS_PER_USER) return null;
  perUser.set(uk, open + 1);

  const conn = { dropId, userId, res, status: null };
  let set = byDrop.get(dropId);
  if (!set) { set = new Set(); byDrop.set(dropId, set); }
  set.add(conn);
  connectionCount++;
  const remove = () => {
    if (!set.delete(conn)) return;
    connectionCount--;
    const left = (perUser.get(uk) || 1) - 1;
    if (left <= 0) perUser.delete(uk); else perUser.set(uk, left);
    if (set.size === 0 && byDrop.get(dropId) === set) byDrop.delete(dropId);
  };
  res.on('close', remove);
  return { conn, write: (name, data) => write(conn, name, data), remove };
}

export const connectionsOpen = () => connectionCount;

// Push each connected user's own fresh status (used after the draw and when a drop completes).
async function refreshDropStatuses(dropId) {
  const set = byDrop.get(dropId);
  if (!set || !set.size) return;
  const conns = [...set];
  const CHUNK = 500;
  for (let i = 0; i < conns.length; i += CHUNK) {
    const slice = conns.slice(i, i + CHUNK);
    try {
      const map = await getStatusesBatch(dropId, [...new Set(slice.map((c) => c.userId))]);
      for (const c of slice) {
        const st = map.get(c.userId);
        if (st) {
          c.status = st;
          write(c, 'your_status', st);
        }
      }
    } catch (err) {
      logger.warn({ err: err.message, dropId }, 'status fan-out failed');
    }
  }
}

// After Redis was unreachable, events may have been missed. Tell everyone connected the real drop
// state and their real status straight from Postgres.
async function resyncDrop(dropId) {
  bumpStatusVersion(dropId);
  const { rows } = await pool.query('SELECT state FROM drops WHERE id = $1', [dropId]);
  const set = byDrop.get(dropId);
  if (!set || !rows[0]) return;
  for (const c of set) write(c, 'drop_state', { state: rows[0].state });
  await refreshDropStatuses(dropId);
}

function onDropEvent(dropId, ev) {
  // A draw or completion changes everyone's status at once: forget every remembered status.
  if (ev.type === 'drop_state' && (ev.state === 'DRAWN' || ev.state === 'COMPLETE')) bumpStatusVersion(dropId);
  const set = byDrop.get(dropId);
  if (!set) return;
  if (ev.type === 'waitlist_cursor') {
    // Everyone waiting moves up together; compute each position locally, no database needed.
    for (const c of set) {
      if (c.status && c.status.state === 'WAITLISTED' && c.status.rank != null) {
        c.status.waitlistPosition = c.status.rank - ev.cursorRank;
        write(c, 'waitlist_moved', { waitlistPosition: c.status.waitlistPosition });
      }
    }
    return;
  }
  const name = ev.type || 'drop_state';
  const { type, ...data } = ev;
  for (const c of set) write(c, name, data);
  if (name === 'drop_state' && (ev.state === 'DRAWN' || ev.state === 'COMPLETE')) {
    refreshDropStatuses(dropId).catch(() => {});
  }
}

function onUserEvent(userId, ev) {
  if (ev.type === 'your_status') invalidateStatus(ev.dropId, userId);
  const set = byDrop.get(ev.dropId);
  if (!set) return;
  const { dropId, type, ...data } = ev;
  for (const c of set) {
    if (c.userId !== userId) continue;
    if (type === 'your_status') c.status = data;
    write(c, type || 'your_status', data);
  }
}

let hubStarted = false;
export async function startEventHub() {
  if (hubStarted) return;
  hubStarted = true;
  let readyCount = 0;
  sub.on('pmessage', (_pattern, channel, message) => {
    try {
      const ev = JSON.parse(message);
      if (channel.startsWith('drop:')) onDropEvent(channel.slice(5), ev);
      else if (channel.startsWith('user:')) onUserEvent(channel.slice(5), ev);
    } catch (err) {
      logger.warn({ err: err.message }, 'bad pubsub message');
    }
  });
  // After a Redis outage events may have been missed: resend everyone's real status.
  sub.on('ready', () => {
    readyCount++;
    if (readyCount > 1) for (const dropId of [...byDrop.keys()]) resyncDrop(dropId).catch(() => {});
  });
  await sub.psubscribe('drop:*', 'user:*');

  heartbeatTimer = setInterval(() => {
    for (const set of byDrop.values()) {
      for (const c of set) {
        if (c.res.writableEnded || c.res.destroyed) continue;
        if (c.res.writableLength > 64 * 1024) { c.res.destroy(); continue; }
        c.res.write(': hb\n\nevent: heartbeat\ndata: {}\n\n');
      }
    }
  }, HEARTBEAT_MS);
  heartbeatTimer.unref();
}

export function closeAllConnections() {
  clearInterval(heartbeatTimer);
  for (const set of byDrop.values()) for (const c of set) { try { c.res.end(); } catch { /* ignore */ } }
}
