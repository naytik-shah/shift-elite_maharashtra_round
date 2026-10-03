/// <reference lib="webworker" />
import { leadingZeroBits, sha256 } from './sha256'

export interface PowRequest { prefix: string; difficulty: number }
export type PowMessage =
  | { type: 'progress'; hashes: number }
  | { type: 'done'; nonce: string; hashes: number; ms: number }

self.onmessage = (e: MessageEvent<PowRequest>) => {
  const { prefix, difficulty } = e.data
  const started = performance.now()
  for (let n = 0; ; n++) {
    if (leadingZeroBits(sha256(prefix + n)) >= difficulty) {
      const done: PowMessage = { type: 'done', nonce: String(n), hashes: n + 1, ms: performance.now() - started }
      self.postMessage(done)
      return
    }
    if (n % 20_000 === 0 && n > 0) self.postMessage({ type: 'progress', hashes: n } satisfies PowMessage)
  }
}
