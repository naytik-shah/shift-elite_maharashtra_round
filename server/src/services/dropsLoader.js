import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { z } from 'zod';
import config from '../config.js';
import logger from '../logger.js';
import { withTx } from '../db.js';
import { sha256 } from '../lib/hash.js';
import { normaliseEmail } from '../lib/email.js';

const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO date with offset');

const dropSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,64}$/i),
  name: z.string().min(1).max(200),
  seats: z.number().int().positive(),
  window_opens_at: iso,
  window_closes_at: iso,
  draw_at: iso,
  confirm_window_min: z.number().int().positive(),
  ticket_price: z.number().int().nonnegative(),
  category: z.string().max(40).optional(),
  venue: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  event_at: iso.optional(),
});

const fileSchema = z.object({
  organisers: z.array(z.string()).default([]),
  drops: z.array(dropSchema).min(1),
});

let organisers = new Set();
export const isOrganiserEmail = (normalised) => organisers.has(normalised);

// Reads config/drops.yaml. New drops are created, existing drops are never changed.
export async function loadDrops() {
  // DROPS_CONFIG_PATH may list several files, separated by commas (for example extra test drops).
  const files = config.dropsConfigPath.split(',').map((f) => f.trim()).filter(Boolean);
  const parts = [];
  for (const f of files) parts.push(fileSchema.parse(YAML.parse(await fs.readFile(path.resolve(f), 'utf8'))));
  const parsed = { organisers: parts.flatMap((p) => p.organisers), drops: parts.flatMap((p) => p.drops) };

  organisers = new Set(parsed.organisers.map((e) => normaliseEmail(e)).filter(Boolean));

  for (const d of parsed.drops) {
    if (Date.parse(d.window_opens_at) >= Date.parse(d.window_closes_at)) {
      throw new Error(`Drop ${d.id}: window_opens_at must be before window_closes_at`);
    }
    const seed = crypto.randomBytes(32).toString('hex');
    const created = await withTx(async (c) => {
      const r = await c.query(
        `INSERT INTO drops (id, name, seats, window_opens_at, window_closes_at, draw_at, confirm_window_min,
                            ticket_price, seed_commit, category, venue, city, description, event_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [d.id, d.name, d.seats, d.window_opens_at, d.window_closes_at, d.draw_at, d.confirm_window_min,
          d.ticket_price, sha256(seed), d.category ?? null, d.venue ?? null, d.city ?? null,
          d.description ?? null, d.event_at ?? null],
      );
      if (r.rowCount === 1) await c.query('INSERT INTO drop_secrets (drop_id, seed) VALUES ($1, $2)', [d.id, seed]);
      return r.rowCount === 1;
    });
    logger.info({ drop: d.id, created }, created ? 'drop created' : 'drop already exists, left unchanged');
  }
  return { organisers: organisers.size, drops: parsed.drops.length };
}

let disposable = new Set();
export async function loadDisposableDomains() {
  try {
    const text = await fs.readFile(path.resolve(config.disposableDomainsPath), 'utf8');
    disposable = new Set(text.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#')));
  } catch (err) {
    logger.warn({ err: err.message }, 'disposable domain list not loaded');
  }
}
export const isDisposableDomain = (domain) => disposable.has(domain);
