/// <reference lib="webworker" />
import type { DrawResults, ManifestEntry } from '@/api/types'
import { manifestHash, rankEntries, seedHash } from './draw'

export interface VerifyRequest {
  seed: string
  seedCommit: string
  manifestHash: string
  entries: ManifestEntry[]
  results: DrawResults
}

export interface VerifyReport {
  seedOk: boolean
  manifestOk: boolean
  rankingOk: boolean
  checked: number
  seats: number
  // 1 based position of the first difference, if any.
  mismatch: { position: number; expected: string | null; got: string | null } | null
  ms: number
}

self.onmessage = (e: MessageEvent<VerifyRequest>) => {
  const { seed, seedCommit, entries, results } = e.data
  const started = performance.now()
  const seedOk = seedHash(seed) === seedCommit
  const manifestOk = manifestHash(entries) === e.data.manifestHash
  const mine = rankEntries(seed, entries)

  let mismatch: VerifyReport['mismatch'] = null
  const n = Math.max(mine.length, results.ranking.length)
  for (let i = 0; i < n; i++) {
    if (mine[i] !== results.ranking[i]) {
      mismatch = { position: i + 1, expected: mine[i] ?? null, got: results.ranking[i] ?? null }
      break
    }
  }

  const report: VerifyReport = {
    seedOk, manifestOk, rankingOk: !mismatch, checked: entries.length, seats: results.seats,
    mismatch, ms: Math.round(performance.now() - started),
  }
  self.postMessage(report)
}
