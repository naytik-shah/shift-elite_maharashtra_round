// Puts a drop back to OPEN with no entries and a fresh seed, so a test can be run again.
// Only for test drops. The audit log is left alone (history stays, the chain stays valid).
//
//   DROP_ID=smoke-test node reset-drop.mjs
import { dbClient, redisClient, flushRedis, CACHE_PATTERNS, resetDrop } from './lib.mjs';

const DROP_ID = process.env.DROP_ID || 'smoke-test';

if (!/test|load/i.test(DROP_ID) && process.env.FORCE !== 'yes') {
  console.error(`Refusing to reset "${DROP_ID}": it does not look like a test drop. Set FORCE=yes to override.`);
  process.exit(1);
}

const db = await dbClient();
const redis = await redisClient();
try {
  const commit = await resetDrop(db, redis, DROP_ID);
  const removed = await flushRedis(redis, CACHE_PATTERNS);
  console.log(`Reset "${DROP_ID}": entries and seats cleared, new seed hash ${commit.slice(0, 12)}..., ${removed} cache keys removed.`);
} catch (err) {
  console.error(`Reset failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
  redis.disconnect();
}
