import { useSyncExternalStore } from 'react'

// A small store that makes the invisible defences visible: the human check, the puzzle and
// the rate limit all report here, and the UI reads it back.

export interface Protection {
  humanCheck: { at: number; method: 'drag' | 'keyboard'; ms: number; samples: number } | null
  pow: { purpose: string; bits: number; ms: number; at: number } | null
  solving: { purpose: string; bits: number } | null
  rateLimit: { until: number; hits: number } | null
  powCount: number
  rateLimitHits: number
}

let state: Protection = { humanCheck: null, pow: null, solving: null, rateLimit: null, powCount: 0, rateLimitHits: 0 }
const listeners = new Set<() => void>()
const emit = () => { listeners.forEach((l) => l()) }
const set = (patch: Partial<Protection>) => { state = { ...state, ...patch }; emit() }

export const protection = {
  get: () => state,
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } },
  powStarted: (purpose: string, bits: number) => set({ solving: { purpose, bits } }),
  powSolved: (purpose: string, bits: number, ms: number) =>
    set({ solving: null, pow: { purpose, bits, ms, at: Date.now() }, powCount: state.powCount + 1 }),
  powFailed: () => set({ solving: null }),
  humanPassed: (method: 'drag' | 'keyboard', ms: number, samples: number) =>
    set({ humanCheck: { at: Date.now(), method, ms, samples } }),
  rateLimited: (retryAfterSeconds: number) =>
    set({ rateLimit: { until: Date.now() + Math.max(1, retryAfterSeconds) * 1000, hits: (state.rateLimit?.hits ?? 0) + 1 }, rateLimitHits: state.rateLimitHits + 1 }),
  clearRateLimit: () => set({ rateLimit: null }),
}

export const useProtection = () => useSyncExternalStore(protection.subscribe, protection.get, protection.get)

// The human check is a dialog owned by one host component. Callers ask and wait.
type Asker = () => Promise<void>
let asker: Asker | null = null
export const registerHumanCheck = (a: Asker | null) => { asker = a }

const PASS_VALID_MS = 2 * 60 * 1000

// Resolves once the person has passed the check. A pass is reused for two minutes, so
// logging in and then entering does not ask twice in a row.
export async function requireHumanCheck(): Promise<void> {
  const last = state.humanCheck
  if (last && Date.now() - last.at < PASS_VALID_MS) return
  if (!asker) return
  await asker()
}

// Always asks, even right after a pass. Used where the check is shown as a live demonstration.
export async function forceHumanCheck(): Promise<void> {
  if (asker) await asker()
}
