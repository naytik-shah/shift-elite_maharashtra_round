import { pool, withTx, isUniqueViolation } from '../db.js';
import { Errors } from '../lib/errors.js';
import { anchorHashFor } from './payments.js';
import { appendAudit } from './audit.js';
import { invalidateStatus, getMyStatus } from './status.js';
import { publishUserEvent } from './events.js';

// Confirming a seat (MVP.md section 6). One conditional UPDATE decides who gets the seat, using the
// database clock. If the same card is already anchored to another seat, the unique index rejects it.
export async function confirmSeat({ dropId, userId, testCard, payerName }) {
  const anchorHash = anchorHashFor(testCard);

  let result;
  try {
    result = await withTx(async (c) => {
      const upd = await c.query(
        `UPDATE seat_slots s
         SET state = 'CONFIRMED', anchor_hash = $1, payer_name = $2, confirmed_at = now()
         FROM entries e
         WHERE s.entry_id = e.id AND e.user_id = $3 AND s.drop_id = $4
           AND s.state = 'PENDING' AND s.confirm_by > now()
         RETURNING s.id AS slot_id, s.slot_no, e.id AS entry_id`,
        [anchorHash, payerName, userId, dropId],
      );
      if (!upd.rowCount) return null;
      const { slot_id: slotId, slot_no: slotNo, entry_id: entryId } = upd.rows[0];
      await c.query("UPDATE entries SET state = 'CONFIRMED' WHERE id = $1", [entryId]);
      const t = await c.query(
        'INSERT INTO tickets (slot_id, holder_user_id, payer_name) VALUES ($1, $2, $3) RETURNING id',
        [slotId, userId, payerName],
      );
      await appendAudit(c, dropId, 'CONFIRMED', { dropId, slotNo, entryId });
      return { ticket: { id: t.rows[0].id, dropId, slotNo, holderName: payerName } };
    });
  } catch (err) {
    if (isUniqueViolation(err) && /anchor_hash/.test(err.constraint || '')) throw Errors.anchorUsed();
    throw err;
  }

  if (!result) throw await explainFailure(dropId, userId);

  await invalidateStatus(dropId, userId);
  const status = await getMyStatus(dropId, userId).catch(() => null);
  if (status) await publishUserEvent(userId, dropId, { type: 'your_status', ...status });
  return result;
}

// The conditional update changed nothing: work out why, so the user gets a precise answer.
async function explainFailure(dropId, userId) {
  const { rows } = await pool.query(
    `SELECT e.state, s.state AS slot_state
     FROM entries e LEFT JOIN seat_slots s ON s.drop_id = e.drop_id AND s.entry_id = e.id
     WHERE e.drop_id = $1 AND e.user_id = $2`,
    [dropId, userId],
  );
  const r = rows[0];
  if (!r) return Errors.notAWinner();
  if (r.state === 'CONFIRMED') return Errors.alreadyConfirmed();
  if (r.state === 'EXPIRED') return Errors.confirmExpired();
  if (r.state === 'WON') return Errors.confirmExpired(); // still marked WON but past its deadline
  return Errors.notAWinner();
}
