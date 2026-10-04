import crypto from 'node:crypto';
import { pool, withTx } from '../db.js';
import { redis } from '../redis.js';
import { sha256 } from '../lib/hash.js';
import logger from '../logger.js';
import { formatDrop, invalidateDrop } from './dropsRepo.js';
import { publishDropEvent } from './events.js';

// Organiser demo tools. They are only mounted when the server is started with DEMO_TOOLS=true.

const DAY = 86_400_000;

export const EVENT_TEMPLATES = [
  { slug: 'sunburn-rooftop', name: 'Sunburn Rooftop Sessions', seats: 300, price: 2500, category: 'Concert', venue: 'Skyline Terrace', city: 'Goa', daysToEvent: 40, description: 'Three DJs on a rooftop above the sea. 300 seats, and everyone who enters has the same chance.' },
  { slug: 'demo-day', name: 'Startup Garage Demo Day', seats: 150, price: 500, category: 'Conference', venue: 'T-Hub Auditorium', city: 'Hyderabad', daysToEvent: 25, description: 'Twenty early teams on one stage, with investors in the room. Limited seats, no queue.' },
  { slug: 'food-carnival', name: 'Monsoon Food Carnival', seats: 2500, price: 350, category: 'Festival', venue: 'Millennium Park', city: 'Kolkata', daysToEvent: 33, description: 'Eighty street food stalls over one weekend. Entry is a fair draw.' },
];

export async function createEvent(index) {
  const t = EVENT_TEMPLATES[index];
  const id = `${t.slug}-${crypto.randomBytes(2).toString('hex')}`;
  const now = Date.now();
  const seed = crypto.randomBytes(32).toString('hex');
  const row = await withTx(async (c) => {
    const r = await c.query(
      `INSERT INTO drops (id, name, seats, window_opens_at, window_closes_at, draw_at, confirm_window_min,
                          ticket_price, seed_commit, category, venue, city, description, event_at)
       VALUES ($1,$2,$3,$4,$5,$6,10,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, name, seats, state, window_opens_at, window_closes_at, draw_at, confirm_window_min, ticket_price,
                 seed_commit, category, venue, city, description, event_at`,
      [id, t.name, t.seats, new Date(now - 60_000), new Date(now + 14 * DAY), new Date(now + 15 * DAY), t.price, sha256(seed),
        t.category, t.venue, t.city, t.description, new Date(now + t.daysToEvent * DAY)],
    );
    await c.query('INSERT INTO drop_secrets (drop_id, seed) VALUES ($1, $2)', [id, seed]);
    return r.rows[0];
  });
  await invalidateDrop(id);
  logger.info({ drop: id }, 'demo event added');
  return formatDrop(row);
}

// Puts every event back to its first state: open, no entries, no seats, a fresh seed. The audit log is left alone.
export async function resetAllDrops() {
  const { rows } = await pool.query('SELECT id FROM drops');
  for (const { id } of rows) {
    const seed = crypto.randomBytes(32).toString('hex');
    await withTx(async (c) => {
      await c.query('DELETE FROM tickets WHERE slot_id IN (SELECT id FROM seat_slots WHERE drop_id = $1)', [id]);
      await c.query('DELETE FROM seat_slots WHERE drop_id = $1', [id]);
      await c.query('DELETE FROM risk_signals WHERE entry_id IN (SELECT id FROM entries WHERE drop_id = $1)', [id]);
      await c.query('DELETE FROM entries WHERE drop_id = $1', [id]);
      await c.query(
        `UPDATE drops SET state = 'OPEN', manifest_hash = NULL, seed_revealed = NULL, cursor_rank = 0,
                scoring_started_at = NULL, scored_at = NULL, seed_commit = $2 WHERE id = $1`,
        [id, sha256(seed)],
      );
      await c.query('UPDATE drop_secrets SET seed = $2 WHERE drop_id = $1', [id, seed]);
    });
  }
  // Cached drop details, draw data, status reads, counters and the simulated crowd's labels.
  for (const pattern of ['cache:*', 'stats:*', 'demo:*']) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  }
  for (const { id } of rows) await publishDropEvent(id, { type: 'drop_state', state: 'OPEN' }).catch(() => {});
  logger.info({ drops: rows.length }, 'demo reset: every event is open again');
  return { reset: rows.length };
}
