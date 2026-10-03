import crypto from 'node:crypto';
import config from '../config.js';
import { cleanIp, subnetOf } from '../lib/ip.js';

// Requests that carry the secret X-Test-Key may use the test features (login codes in the response,
// easy puzzles, their own client IP). Without the key, or if no key is configured, nothing changes.
const keyDigest = config.testKey ? crypto.createHash('sha256').update(config.testKey).digest() : null;

export function testAccess(req, _res, next) {
  req.isTest = false;
  const key = req.headers['x-test-key'];
  if (keyDigest && typeof key === 'string') {
    // Compare digests in constant time so the key can not be guessed from response timing.
    const d = crypto.createHash('sha256').update(key).digest();
    if (crypto.timingSafeEqual(d, keyDigest)) {
      req.isTest = true;
      const fake = cleanIp(req.headers['x-test-client-ip']);
      if (fake) {
        req.clientIp = fake;
        req.subnet = subnetOf(fake);
      }
    }
  }
  next();
}
