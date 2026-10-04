/// <reference lib="webworker" />
import { sha256 } from 'js-sha256'
import { leadingZeroBits } from './bits'

export interface PowRequest { prefix: string; difficulty: number }
export type PowMessage =
  | { type: 'progress'; hashes: number }
  | { type: 'done'; nonce: string }

// Smallest decimal nonce, counting up from 0, whose hash has enough leading zero bits.
self.onmessage = (e: MessageEvent<PowRequest>) => {
  const { prefix, difficulty } = e.data
  for (let n = 0; ; n++) {
    if (leadingZeroBits(sha256.array(prefix + n)) >= difficulty) {
      self.postMessage({ type: 'done', nonce: String(n) } satisfies PowMessage)
      return
    }
    if (n % 20_000 === 0 && n > 0) self.postMessage({ type: 'progress', hashes: n } satisfies PowMessage)
  }
}
