import { redis } from '../redis.js';

const minute = () => Math.floor(Date.now() / 60000);

// Cheap per-minute counters for the dashboard. They are added up in memory and written to Redis once
// a second, so counting costs nothing per request. A failure here never affects a request.
const pending = new Map();
const add = (key) => pending.set(key, (pending.get(key) || 0) + 1);

function flush() {
  if (!pending.size) return;
  const batch = [...pending];
  pending.clear();
  const p = redis.pipeline();
  for (const [key, n] of batch) p.incrby(key, n).expire(key, 3600);
  p.exec().catch(() => {});
}
setInterval(flush, 1000).unref();

export const countEntry = (dropId) => add(`stats:${dropId}:entries:${minute()}`);
export const countRateLimited = () => add(`stats:ratelimited:${minute()}`);

// Larger of the current and previous minute (the current one is still filling up).
export async function perMinute(key) {
  try {
    const m = minute();
    const [cur, prev] = await redis.mget(`${key}:${m}`, `${key}:${m - 1}`);
    return Math.max(Number(cur || 0), Number(prev || 0));
  } catch {
    return 0;
  }
}
