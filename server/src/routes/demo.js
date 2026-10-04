import express from 'express';
import { z } from 'zod';
import config from '../config.js';
import { Errors } from '../lib/errors.js';
import { requireOrganiser } from '../middleware/auth.js';
import { EVENT_TEMPLATES, createEvent, resetAllDrops } from '../services/demo.js';
import { PLAN, startCrowd, crowdReport } from '../services/demoCrowd.js';
import { getDropCached } from '../services/dropsRepo.js';
import { dropIdOf } from './drops.js';

// Organiser demo tools. Not reachable at all unless DEMO_TOOLS=true (it answers 404, as if it did not exist).
const router = express.Router();
router.use('/admin/demo', (_req, _res, next) => (config.demoTools ? next() : next(Errors.notFound())), requireOrganiser);

router.get('/admin/demo/status', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({
    enabled: true,
    templates: EVENT_TEMPLATES.map((t, index) => ({ index, name: t.name, category: t.category, venue: t.venue, city: t.city, seats: t.seats, price: t.price })),
    crowd: { attempts: PLAN.attempts },
  });
});

router.post('/admin/demo/events', async (req, res) => {
  const { index } = z.object({ index: z.number().int().min(0).max(EVENT_TEMPLATES.length - 1) }).parse(req.body ?? {});
  res.status(201).json({ drop: await createEvent(index) });
});

router.post('/admin/demo/reset', async (_req, res) => {
  res.json(await resetAllDrops());
});

router.post('/admin/demo/crowd', async (req, res) => {
  const { dropId } = z.object({ dropId: z.string().min(1).max(64) }).parse(req.body ?? {});
  const drop = await getDropCached(dropId);
  if (!drop) throw Errors.notFound('Drop not found.');
  if (drop.state !== 'OPEN') throw Errors.invalidState('The crowd can only enter while entries are open.');
  res.status(202).json(await startCrowd(dropId));
});

router.get('/admin/demo/crowd/:dropId', async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await crowdReport(dropIdOf(req)));
});

export default router;
