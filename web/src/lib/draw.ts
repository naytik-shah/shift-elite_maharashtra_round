import { sha256 } from 'js-sha256'
import type { ManifestEntry } from '@/api/types'

// The draw, exactly as PRD 9.1 defines it. The backend runs the same steps, so any
// change here makes the verify page disagree with a correct draw.

export const seedHash = (seed: string) => sha256(seed)

// Objects are rebuilt in a fixed key order with numeric weights, which is what the
// backend hashes.
export function manifestHash(entries: ManifestEntry[]) {
  return sha256(JSON.stringify(entries.map((e) => ({ entryId: e.entryId, weight: Number(e.weight) }))))
}

export function rankEntries(seed: string, entries: ManifestEntry[]): string[] {
  const keyed = entries.map((e) => {
    const h = sha256.hmac(seed, e.entryId)
    const u = (parseInt(h.slice(0, 13), 16) + 1) / (2 ** 52 + 1)
    return { id: e.entryId, key: Math.log(u) / Number(e.weight) }
  })
  keyed.sort((a, b) => (b.key - a.key) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return keyed.map((k) => k.id)
}
