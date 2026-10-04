import express from 'express';
import { z } from 'zod';
import { pool, isDbBusy } from '../db.js';
import { Errors } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { idempotency } from '../middleware/idempotency.js';
import { verifyPow, undoPow } from '../services/pow.js';
import { confirmSeat } from '../services/confirm.js';
import { declineSeat } from '../services/waitlist.js';
import { countEntry } from '../services/stats.js';
import { dropIdOf } from './drops.js';

const router = express.Router();

const entrySchema = z.object({
  pow: z.object({ challengeId: z.string().max(64), nonce: z.string().max(24) }).optional(),
  deviceFingerprint: z.string().trim().max(128).optional(),
});

// One statement does the whole entry: the row lock on the drop (FOR SHARE) lets many entries run at
// once but makes the close step wait for them, so nothing can commit after the drop is closed.
const INSERT_ENTRY = `
  INSERT INTO entries (drop_id, user_id, device_fp, ip, subnet, pow_server_ms)
  SELECT d.id, $2, $3, $4::inet, $5, $6 FROM drops d
  WHERE d.id = $1 AND d.state = 'OPEN' AND now() >= d.window_opens_at AND now() <= d.window_closes_at
  FOR SHARE OF d
  ON CONFLICT (drop_id, user_id) DO NOTHING
  RETURNING id, state`;

router.post('/drops/:dropId/entries', requireAuth, idempotency, async (req, res) => {
  const dropId = dropIdOf(req);
  const body = entrySchema.parse(req.body ?? {});
  const userId = req.session.userId;

  const powMs = await verifyPow(body.pow, 'entry', req);

  let ins;
  try {
    ins = await pool.query(INSERT_ENTRY, [dropId, userId, body.deviceFingerprint || null, req.clientIp, req.subnet, powMs]);
  } catch (err) {
    if (isDbBusy(err)) await undoPow(req);
    throw err;
  }
  if (!ins.rowCount) {
    // Nothing inserted: say exactly why.
    const mine = await pool.query('SELECT 1 FROM entries WHERE drop_id = $1 AND user_id = $2', [dropId, userId]);
    if (mine.rowCount) throw Errors.alreadyEntered();
    const drop = await pool.query('SELECT 1 FROM drops WHERE id = $1', [dropId]);
    if (!drop.rowCount) throw Errors.notFound('Drop not found.');
    throw Errors.dropNotOpen();
  }

  countEntry(dropId);
  res.status(201).json({ entryId: ins.rows[0].id, state: ins.rows[0].state });
});

const confirmSchema = z.object({
  testCard: z.string().trim().min(3).max(128),
  payerName: z.string().trim().min(1).max(100),
});

router.post('/drops/:dropId/entries/me/confirm', requireAuth, idempotency, async (req, res) => {
  const dropId = dropIdOf(req);
  const body = confirmSchema.parse(req.body ?? {});
  const { ticket } = await confirmSeat({ dropId, userId: req.session.userId, testCard: body.testCard, payerName: body.payerName });
  res.json({ ticket: { ...ticket, seatNo: ticket.slotNo } });
});

// "Skip": the winner gives the seat up and the next person on the waitlist is offered it right away.
router.post('/drops/:dropId/entries/me/decline', requireAuth, idempotency, async (req, res) => {
  const result = await declineSeat({ dropId: dropIdOf(req), userId: req.session.userId });
  res.json(result);
});

export default router;
