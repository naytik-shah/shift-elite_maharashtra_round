import { api, errorCode } from '@/api'
import type { PowChallenge, PowPurpose, PowSolution } from '@/api/types'
import type { PowMessage, PowRequest } from './pow.worker'

// Solves the puzzle off the main thread so the page stays responsive.
export function solvePow(challenge: PowChallenge): Promise<PowSolution> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pow.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<PowMessage>) => {
      if (e.data.type !== 'done') return
      worker.terminate()
      resolve({ challengeId: challenge.challengeId, nonce: e.data.nonce })
    }
    worker.onerror = (err) => {
      worker.terminate()
      reject(new Error(err.message || 'Could not solve the puzzle'))
    }
    worker.postMessage({ prefix: challenge.prefix, difficulty: challenge.difficulty } satisfies PowRequest)
  })
}

// Fetches a puzzle, solves it and runs the call. A puzzle can expire while it is being
// solved, so one POW_INVALID gets a fresh puzzle and a second try.
export async function withPow<T>(purpose: PowPurpose, call: (pow: PowSolution) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const pow = await solvePow(await api.getPowChallenge(purpose))
    try {
      return await call(pow)
    } catch (err) {
      if (errorCode(err) === 'POW_INVALID' && attempt === 0) continue
      throw err
    }
  }
}
