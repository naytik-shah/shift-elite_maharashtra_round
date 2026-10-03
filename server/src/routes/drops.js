import express from 'express';
import { pool } from '../db.js';
import { Errors } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { getDropCached, listDropsCached, getDrawPublic } from '../services/dropsRepo.js';
import { getManifest, getResults } from '../services/draw.js';
import { getMyStatus } from '../services/status.js';
import { addConnection, connectionsOpen } from '../services/events.js';

const router = express.Router();

export function dropIdOf(req) {
  const id = req.params.dropId;
  if (!/^[a-z0-9_-]{1,64}$/i.test(id)) throw Errors.notFound('Drop not found.');
  return id;
}

router.get('/drops', async (_req, res) => {
  const drops = await listDropsCached();
  const serverTime = new Date().toISOString();
  res.json({ drops: drops.map(({ id, name, seats, state, windowOpensAt, windowClosesAt, drawAt, ...rest }) => (
    { id, name, seats, state, windowOpensAt, windowClosesAt, drawAt, ...rest }
  )), serverTime });
});

router.get('/drops/:dropId', async (req, res) => {
  const drop = await getDropCached(dropIdOf(req));
  if (!drop) throw Errors.notFound('Drop not found.');
  res.json({ ...drop, serverTime: new Date().toISOString() });
});

// Draw verification (public). The manifest and results only exist once the draw has run.
router.get('/drops/:dropId/draw', async (req, res) => {
  const draw = await getDrawPublic(dropIdOf(req));
  if (!draw) throw Errors.notFound('Drop not found.');
  res.json(draw);
});

async function requireDrawn(dropId) {
  const draw = await getDrawPublic(dropId);
  if (!draw) throw Errors.notFound('Drop not found.');
  if (!draw.manifestHash) throw Errors.notFound('The draw has not happened yet.');
}

router.get('/drops/:dropId/draw/manifest', async (req, res) => {
  const dropId = dropIdOf(req);
  await requireDrawn(dropId);
  res.json(await getManifest(dropId));
});

router.get('/drops/:dropId/draw/results', async (req, res) => {
  const dropId = dropIdOf(req);
  await requireDrawn(dropId);
  res.json(await getResults(dropId));
});

router.get('/tickets/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, s.drop_id, s.slot_no, t.payer_name
     FROM tickets t JOIN seat_slots s ON s.id = t.slot_id
     WHERE t.holder_user_id = $1 ORDER BY t.issued_at`,
    [req.session.userId],
  );
  res.json({ tickets: rows.map((r) => ({ id: r.id, dropId: r.drop_id, slotNo: r.slot_no, seatNo: r.slot_no, holderName: r.payer_name })) });
});

// Live updates. The first thing sent is always the user's real current status, so a reconnect
// can never leave the page wrong even if events were missed.
const MAX_SSE_PER_PROCESS = Number(process.env.MAX_SSE_CONNECTIONS || 40000);
router.get('/drops/:dropId/events', requireAuth, async (req, res) => {
  const dropId = dropIdOf(req);
  const userId = req.session.userId;
  const drop = await getDropCached(dropId);
  if (!drop) throw Errors.notFound('Drop not found.');
  if (connectionsOpen() >= MAX_SSE_PER_PROCESS) throw Errors.busy(5);

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);
  res.write('retry: 3000\n\n');

  const handle = addConnection(dropId, userId, res);
  if (!handle) {
    res.write('event: error\ndata: {"code":"TOO_MANY_STREAMS"}\n\n');
    res.end();
    return;
  }
  try {
    const status = await getMyStatus(dropId, userId);
    if (status) {
      handle.conn.status = status;
      handle.write('your_status', status);
    }
    const fresh = await getDropCached(dropId);
    handle.write('drop_state', { state: (fresh || drop).state });
  } catch {
    // The stream stays open; the client falls back to polling if it needs to.
  }
});

// Status of the signed-in user for one drop.
router.get('/drops/:dropId/entries/me', requireAuth, async (req, res) => {
  const status = await getMyStatus(dropIdOf(req), req.session.userId);
  if (!status) throw Errors.notFound('You have not entered this drop.');
  res.set('Cache-Control', 'no-store').json(status);
});

export default router;
