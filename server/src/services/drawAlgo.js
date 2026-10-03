import crypto from 'node:crypto';
import { sha256 } from '../lib/hash.js';

// The weighted draw from PRD 9.1 (Efraimidis-Spirakis). Pure functions: the verify page and the
// smoke test recompute exactly this from the public seed and manifest.

export const ALGORITHM = 'es-weighted-v1';

export const byEntryId = (a, b) => (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0);

// entries: [{ entryId, weight }] with weight as a number. Returns the entry ids, rank 1 first.
export function rankEntries(seed, entries) {
  const keyed = entries.map(({ entryId, weight }) => {
    const h = crypto.createHmac('sha256', seed).update(entryId).digest('hex');
    const u = (parseInt(h.slice(0, 13), 16) + 1) / (2 ** 52 + 1);
    return { entryId, key: Math.log(u) / weight };
  });
  keyed.sort((a, b) => (b.key - a.key) || (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0));
  return keyed.map((k) => k.entryId);
}

export function buildManifest(rows) {
  // numeric columns arrive as strings, convert before hashing
  const entries = rows.map((r) => ({ entryId: r.id, weight: Number(r.weight) })).sort(byEntryId);
  return { entries, hash: sha256(JSON.stringify(entries)) };
}
