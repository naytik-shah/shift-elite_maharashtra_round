import { pool, withTx } from '../db.js';
import logger from '../logger.js';
import { appendAudit } from './audit.js';
import { invalidateDrop } from './dropsRepo.js';
import { getMyStatus, invalidateStatus, bumpStatusVersion } from './status.js';
import { publishDropEvent, publishUserEvent } from './events.js';
import { enqueueMail, mailTemplates } from './mailer.js';

// One pass of the background job (MVP.md section 7): expire unconfirmed seats, hand each to the next
// waitlisted entry, then complete drops that have no pending seats left. A Postgres advisory lock
// means only one worker acts at a time even if several are running.
export async function runTick() {
  const client = await pool.connect();
  let broken = false;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(2) AS locked');
    if (!lock.rows[0].locked) return { skipped: true };
    try {
      const moved = await expireAndPromote(client);
      const completed = await completeDrops(client);
      return { ...moved, completed };
    } finally {
      await client.query('SELECT pg_advisory_unlock(2)').catch(() => { broken = true; });
    }
  } catch (err) {
    broken = true;
    throw err;
  } finally {
    client.release(broken);
  }
}

async function expireAndPromote(client) {
  const cursors = new Map(); // dropId -> highest rank handed a seat this tick
  let expired = 0;
  let promoted = 0;
  let unfilled = 0;

  for (let round = 0; round < 25; round++) {
    const due = await client.query(
      "SELECT id FROM seat_slots WHERE state = 'PENDING' AND confirm_by <= now() ORDER BY confirm_by LIMIT 200",
    );
    if (!due.rowCount) break;
    let handled = 0;
    for (const { id } of due.rows) {
      const r = await processSlot(client, id);
      if (!r) continue;
      handled++;
      expired++;
      if (r.promoted) {
        promoted++;
        cursors.set(r.dropId, Math.max(cursors.get(r.dropId) || 0, r.promoted.rank));
      } else {
        unfilled++;
      }
      await announce(r);
    }
    if (!handled) break; // everything left is locked by a confirm in progress, try next tick
    if (due.rowCount < 200) break;
  }

  for (const [dropId, cursorRank] of cursors) {
    await publishDropEvent(dropId, { type: 'waitlist_cursor', cursorRank });
  }
  return { expired, promoted, unfilled };
}

// Locks the slot first (the same order the confirm statement uses), so a confirm and an expiry on the
// same seat can never both win and can never deadlock.
async function processSlot(client, slotId) {
  return withTx(async (c) => {
    const s = await c.query(
      `SELECT s.id, s.drop_id, s.slot_no, s.entry_id, d.confirm_window_min, d.name
       FROM seat_slots s JOIN drops d ON d.id = s.drop_id
       WHERE s.id = $1 AND s.state = 'PENDING' AND s.confirm_by <= now()
       FOR UPDATE OF s SKIP LOCKED`,
      [slotId],
    );
    if (!s.rowCount) return null;
    const slot = s.rows[0];
    const dropId = slot.drop_id;

    const exp = await c.query("UPDATE entries SET state = 'EXPIRED' WHERE id = $1 AND state = 'WON' RETURNING user_id", [slot.entry_id]);
    await appendAudit(c, dropId, 'EXPIRED', { dropId, slotNo: slot.slot_no, entryId: slot.entry_id });

    // Strictly the smallest waiting rank, so waitlist position stays rank minus the cursor.
    const next = await c.query(
      `SELECT e.id, e.user_id, e.rank, u.email
       FROM entries e JOIN users u ON u.id = e.user_id
       WHERE e.drop_id = $1 AND e.state = 'WAITLISTED'
       ORDER BY e.rank LIMIT 1 FOR UPDATE OF e`,
      [dropId],
    );

    const base = { dropId, dropName: slot.name, windowMin: slot.confirm_window_min, expiredUserId: exp.rows[0]?.user_id || null };
    if (!next.rowCount) {
      await c.query("UPDATE seat_slots SET state = 'UNFILLED' WHERE id = $1", [slotId]);
      await appendAudit(c, dropId, 'UNFILLED', { dropId, slotNo: slot.slot_no });
      return { ...base, promoted: null };
    }

    const n = next.rows[0];
    const upd = await c.query(
      `UPDATE seat_slots SET entry_id = $2, confirm_by = now() + ($3::int * interval '1 minute')
       WHERE id = $1 AND state = 'PENDING' AND confirm_by <= now() RETURNING confirm_by`,
      [slotId, n.id, slot.confirm_window_min],
    );
    await c.query("UPDATE entries SET state = 'WON' WHERE id = $1", [n.id]);
    await c.query('UPDATE drops SET cursor_rank = GREATEST(cursor_rank, $2) WHERE id = $1', [dropId, n.rank]);
    await appendAudit(c, dropId, 'PROMOTED', { dropId, slotNo: slot.slot_no, from: slot.entry_id, to: n.id, rank: n.rank });
    return {
      ...base,
      promoted: { userId: n.user_id, email: n.email, rank: n.rank, confirmBy: new Date(upd.rows[0].confirm_by) },
    };
  }, client);
}

// Live update, cache clear and email for the two people affected. Never allowed to fail the tick.
async function announce(r) {
  try {
    const users = [r.expiredUserId, r.promoted?.userId].filter(Boolean);
    for (const userId of users) await invalidateStatus(r.dropId, userId);
    for (const userId of users) {
      const status = await getMyStatus(r.dropId, userId);
      if (status) await publishUserEvent(userId, r.dropId, { type: 'your_status', ...status });
    }
    if (r.promoted) {
      const t = mailTemplates.promoted(r.dropName, r.dropId, r.promoted.confirmBy, r.windowMin);
      await enqueueMail({ to: r.promoted.email, ...t });
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'could not announce waitlist change');
  }
}

async function completeDrops(client) {
  const open = await client.query(
    `SELECT d.id FROM drops d
     WHERE d.state = 'DRAWN' AND NOT EXISTS (SELECT 1 FROM seat_slots s WHERE s.drop_id = d.id AND s.state = 'PENDING')`,
  );
  let completed = 0;
  for (const { id: dropId } of open.rows) {
    const done = await withTx(async (c) => {
      const upd = await c.query(
        `UPDATE drops SET state = 'COMPLETE'
         WHERE id = $1 AND state = 'DRAWN'
           AND NOT EXISTS (SELECT 1 FROM seat_slots s WHERE s.drop_id = $1 AND s.state = 'PENDING')
         RETURNING id`,
        [dropId],
      );
      if (!upd.rowCount) return false;
      const ns = await c.query("UPDATE entries SET state = 'NOT_SELECTED' WHERE drop_id = $1 AND state = 'WAITLISTED'", [dropId]);
      const slots = await c.query('SELECT state, COUNT(*)::int AS n FROM seat_slots WHERE drop_id = $1 GROUP BY state', [dropId]);
      await appendAudit(c, dropId, 'COMPLETE', {
        dropId, notSelected: ns.rowCount, slots: Object.fromEntries(slots.rows.map((x) => [x.state, x.n])),
      });
      return true;
    }, client);
    if (done) {
      completed++;
      await bumpStatusVersion(dropId);
      await invalidateDrop(dropId);
      await publishDropEvent(dropId, { type: 'drop_state', state: 'COMPLETE' });
    }
  }
  return completed;
}
