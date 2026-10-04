import express from 'express';
import { z } from 'zod';
import config from '../config.js';
import { pool, withTx } from '../db.js';
import { redis } from '../redis.js';
import { Errors } from '../lib/errors.js';
import { requireOrganiser } from '../middleware/auth.js';
import { idempotency } from '../middleware/idempotency.js';
import { closeDrop, runDraw } from '../services/draw.js';
import { appendAudit } from '../services/audit.js';
import { invalidateDrop } from '../services/dropsRepo.js';
import { perMinute } from '../services/stats.js';
import { dropIdOf } from './drops.js';

const router = express.Router();
router.use('/admin', requireOrganiser);

router.post('/admin/drops/:dropId/close', idempotency, async (req, res) => {
  res.json(await closeDrop(dropIdOf(req)));
});

router.post('/admin/drops/:dropId/draw', idempotency, async (req, res) => {
  res.json(await runDraw(dropIdOf(req)));
});

// Scoring only exists when a scoring service is configured; until then the draw uses weight 1.0 for everyone.
if (config.scoringUrl) {
  router.post('/admin/drops/:dropId/score', idempotency, async (req, res) => {
    const dropId = dropIdOf(req);
    const start = await pool.query(
      "UPDATE drops SET scoring_started_at = now() WHERE id = $1 AND state = 'CLOSED' AND scoring_started_at IS NULL RETURNING id",
      [dropId],
    );
    if (!start.rowCount) {
      const exists = await pool.query('SELECT 1 FROM drops WHERE id = $1', [dropId]);
      if (!exists.rowCount) throw Errors.notFound('Drop not found.');
      throw Errors.invalidState('Scoring runs once, after entries are closed.');
    }
    let result;
    try {
      const r = await fetch(`${config.scoringUrl}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropId }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!r.ok) throw new Error(`scoring service answered ${r.status}`);
      result = await r.json();
    } catch (err) {
      await pool.query('UPDATE drops SET scoring_started_at = NULL WHERE id = $1 AND scored_at IS NULL', [dropId]);
      throw Errors.scoringFailed(`Scoring failed: ${err.message}`);
    }
    await withTx(async (c) => {
      await c.query('UPDATE drops SET scored_at = now() WHERE id = $1', [dropId]);
      await appendAudit(c, dropId, 'SCORED', { dropId, scored: result.scored, flagged: result.flagged });
    });
    res.json({ scored: result.scored, flagged: result.flagged, durationMs: result.durationMs });
  });
}

router.get('/admin/drops/:dropId/live', async (req, res) => {
  const dropId = dropIdOf(req);
  const ck = `cache:live:${dropId}`;
  let body = null;
  try {
    const hit = await redis.get(ck);
    if (hit) body = JSON.parse(hit);
  } catch { /* cache is optional */ }

  if (!body) {
    const [drop, entries, slots] = await Promise.all([
      pool.query('SELECT state, seats, scored_at FROM drops WHERE id = $1', [dropId]),
      pool.query(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE state = 'WAITLISTED')::int AS waitlist_left
         FROM entries WHERE drop_id = $1`, [dropId]),
      pool.query('SELECT state, COUNT(*)::int AS n FROM seat_slots WHERE drop_id = $1 GROUP BY state', [dropId]),
    ]);
    if (!drop.rowCount) throw Errors.notFound('Drop not found.');
    const by = Object.fromEntries(slots.rows.map((r) => [r.state, r.n]));
    body = {
      state: drop.rows[0].state,
      seats: drop.rows[0].seats,
      entries: entries.rows[0].total,
      scored: Boolean(drop.rows[0].scored_at),
      slotsPending: by.PENDING || 0,
      slotsConfirmed: by.CONFIRMED || 0,
      slotsUnfilled: by.UNFILLED || 0,
      waitlistLeft: entries.rows[0].waitlist_left,
    };
    redis.set(ck, JSON.stringify(body), 'EX', 1).catch(() => {});
  }
  const [entriesPerMin, rateLimitedPerMin] = await Promise.all([
    perMinute(`stats:${dropId}:entries`),
    perMinute('stats:ratelimited'),
  ]);
  res.set('Cache-Control', 'no-store').json({ ...body, entriesPerMin, rateLimitedPerMin });
});

router.get('/admin/drops/:dropId/slots', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT slot_no, state, entry_id, confirm_by FROM seat_slots WHERE drop_id = $1 ORDER BY slot_no LIMIT 5000',
    [dropIdOf(req)],
  );
  res.set('Cache-Control', 'no-store').json({
    slots: rows.map((r) => ({
      slotNo: r.slot_no,
      state: r.state,
      entryId: r.entry_id,
      confirmBy: r.state === 'PENDING' ? new Date(r.confirm_by).toISOString() : null,
    })),
  });
});

const flagsQuery = z.object({
  minScore: z.coerce.number().int().min(0).max(100).default(0),
  maxScore: z.coerce.number().int().min(0).max(100).default(100),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
const FLAGS_PAGE = 50;

// Entries the scorer gave a risk score, highest risk first. minScore and maxScore bound a tier.
router.get('/admin/drops/:dropId/flags', async (req, res) => {
  const q = flagsQuery.parse(req.query);
  const dropId = dropIdOf(req);
  const [rows, total] = await Promise.all([
    pool.query(
      `SELECT e.id, e.risk, e.weight, rs.cluster_id, rs.cluster_size
         FROM entries e JOIN risk_signals rs ON rs.entry_id = e.id
        WHERE e.drop_id = $1 AND e.risk BETWEEN $2 AND $3
        ORDER BY e.risk DESC, e.id LIMIT $4 OFFSET $5`,
      [dropId, q.minScore, q.maxScore, FLAGS_PAGE, (q.page - 1) * FLAGS_PAGE],
    ),
    pool.query(
      'SELECT COUNT(*)::int AS n FROM entries e JOIN risk_signals rs ON rs.entry_id = e.id WHERE e.drop_id = $1 AND e.risk BETWEEN $2 AND $3',
      [dropId, q.minScore, q.maxScore],
    ),
  ]);
  res.set('Cache-Control', 'no-store').json({
    flags: rows.rows.map((r) => ({
      entryId: r.id, risk: r.risk, weight: Number(r.weight), clusterId: r.cluster_id, clusterSize: r.cluster_size,
    })),
    page: q.page,
    total: total.rows[0].n,
  });
});

// The evidence behind one score: the four signal families, the reasons in plain words and the linked entries.
router.get('/admin/drops/:dropId/flags/:entryId', async (req, res) => {
  const entryId = z.string().uuid().safeParse(req.params.entryId);
  if (!entryId.success) throw Errors.notFound('Entry not found.');
  const { rows } = await pool.query(
    `SELECT e.id, e.risk, e.weight, rs.device, rs.ip, rs.timing, rs.email, rs.reasons, rs.linked
       FROM entries e JOIN risk_signals rs ON rs.entry_id = e.id
      WHERE e.id = $1 AND e.drop_id = $2`,
    [entryId.data, dropIdOf(req)],
  );
  if (!rows.length) throw Errors.notFound('No score for that entry.');
  const r = rows[0];
  res.set('Cache-Control', 'no-store').json({
    entryId: r.id,
    risk: r.risk,
    weight: Number(r.weight),
    signals: { device: r.device, ip: r.ip, timing: r.timing, email: r.email },
    reasons: r.reasons ?? [],
    linkedEntries: r.linked ?? [],
  });
});

const auditQuery = z.object({
  dropId: z.string().max(64).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// Newest first; pass ?before=<seq> to page further back.
router.get('/admin/audit', async (req, res) => {
  const q = auditQuery.parse(req.query);
  const { rows } = await pool.query(
    `SELECT seq, type, payload, at, prev_hash, hash FROM audit_log
     WHERE ($1::text IS NULL OR drop_id = $1) AND ($2::bigint IS NULL OR seq < $2)
     ORDER BY seq DESC LIMIT $3`,
    [q.dropId ?? null, q.before ?? null, q.limit],
  );
  res.set('Cache-Control', 'no-store').json({
    events: rows.map((r) => ({
      seq: r.seq, type: r.type, payload: r.payload, at: new Date(r.at).toISOString(), prevHash: r.prev_hash, hash: r.hash,
    })),
  });
});

// Simulator results (PRD 11.3).
const runSchema = z.object({ runId: z.string().min(1).max(100), scenario: z.string().min(1).max(40) }).passthrough();

router.post('/admin/runs', async (req, res) => {
  const run = runSchema.parse(req.body ?? {});
  await pool.query(
    `INSERT INTO sim_runs (run_id, scenario, payload) VALUES ($1, $2, $3)
     ON CONFLICT (run_id) DO UPDATE SET scenario = EXCLUDED.scenario, payload = EXCLUDED.payload`,
    [run.runId, run.scenario, JSON.stringify(run)],
  );
  res.status(201).json({ runId: run.runId });
});

router.get('/admin/runs', async (_req, res) => {
  const { rows } = await pool.query('SELECT run_id, scenario, payload, created_at FROM sim_runs ORDER BY created_at DESC LIMIT 200');
  res.json({
    runs: rows.map((r) => ({
      runId: r.run_id, scenario: r.scenario, botSharePercent: r.payload.botSharePercent ?? null, createdAt: new Date(r.created_at).toISOString(),
    })),
  });
});

router.get('/admin/runs/:runId', async (req, res) => {
  const { rows } = await pool.query('SELECT payload FROM sim_runs WHERE run_id = $1', [req.params.runId]);
  if (!rows.length) throw Errors.notFound('Run not found.');
  res.json(rows[0].payload);
});

export default router;
