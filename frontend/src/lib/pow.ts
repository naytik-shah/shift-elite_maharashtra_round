import type { PowChallenge, PowSolution } from '@/api/types'
import type { PowMessage, PowRequest } from './pow.worker'

// Solves the challenge off the main thread so the page stays responsive.
// onProgress gets a rough 0..1 estimate based on the expected number of hashes.
export function solvePow(challenge: PowChallenge, onProgress?: (p: number) => void): Promise<PowSolution> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pow.worker.ts', import.meta.url), { type: 'module' })
    const expected = 2 ** challenge.difficulty
    worker.onmessage = (e: MessageEvent<PowMessage>) => {
      if (e.data.type === 'progress') {
        // Geometric search, so this is the chance we would have finished by now.
        onProgress?.(1 - Math.exp(-e.data.hashes / expected))
        return
      }
      onProgress?.(1)
      worker.terminate()
      resolve({ challengeId: challenge.challengeId, nonce: e.data.nonce })
    }
    worker.onerror = (err) => {
      worker.terminate()
      reject(new Error(err.message || 'Could not solve the challenge'))
    }
    worker.postMessage({ prefix: challenge.prefix, difficulty: challenge.difficulty } satisfies PowRequest)
  })
}
