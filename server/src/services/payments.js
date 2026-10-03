import config from '../config.js';
import { sha256, hmacSha256 } from '../lib/hash.js';

// Mock payment module. The test card always succeeds. Only a keyed hash of the card is stored,
// so the same card maps to the same anchor but the card itself can not be recovered.
export function cardFingerprint(testCard) {
  return sha256(String(testCard).trim().toLowerCase());
}

export function anchorHashFor(testCard) {
  return hmacSha256(config.anchorPepper, cardFingerprint(testCard));
}
