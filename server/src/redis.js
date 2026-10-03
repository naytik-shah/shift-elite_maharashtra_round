import Redis from 'ioredis';
import config from './config.js';
import logger from './logger.js';

let lastErrorLog = 0;
function make(name, extra = {}) {
  const client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => Math.min(times * 100, 2000),
    enableReadyCheck: true,
    connectionName: `fairdrop-${name}`,
    ...extra,
  });
  client.on('error', (err) => {
    // Log at most once every 5 seconds, otherwise an outage floods the logs.
    const now = Date.now();
    if (now - lastErrorLog > 5000) {
      lastErrorLog = now;
      logger.error({ err: err.message, client: name }, 'redis error');
    }
  });
  return client;
}

function defineScripts(client) {
  // Atomic one-time-code check, so many parallel guesses can never exceed the attempt limit.
  client.defineCommand('otpCheck', {
    numberOfKeys: 1,
    lua: `
      local v = redis.call('GET', KEYS[1])
      if not v then return 'none' end
      local o = cjson.decode(v)
      local max = tonumber(ARGV[2])
      if o.attempts >= max then redis.call('DEL', KEYS[1]); return 'locked' end
      if o.codeHash == ARGV[1] then redis.call('DEL', KEYS[1]); return 'ok' end
      o.attempts = o.attempts + 1
      if o.attempts >= max then redis.call('DEL', KEYS[1]); return 'locked' end
      redis.call('SET', KEYS[1], cjson.encode(o), 'KEEPTTL')
      return 'invalid'
    `,
  });

  // Fixed-window counters, several at once in one round trip. Arguments after the keys are
  // (limit, windowSeconds) pairs. Returns 0 if every counter is within its limit, otherwise the
  // milliseconds until the slowest exceeded window resets.
  client.defineCommand('rlTake', {
    lua: `
      local n = tonumber(ARGV[1])
      local wait = 0
      for i = 1, n do
        local key = ARGV[1 + i]
        local limit = tonumber(ARGV[1 + n + (i - 1) * 2 + 1])
        local win = tonumber(ARGV[1 + n + (i - 1) * 2 + 2])
        local c = redis.call('INCR', key)
        if c == 1 then redis.call('EXPIRE', key, win) end
        if c > limit then
          local ttl = redis.call('PTTL', key)
          if ttl < 0 then redis.call('EXPIRE', key, win); ttl = win * 1000 end
          if ttl > wait then wait = ttl end
        end
      end
      return wait
    `,
    numberOfKeys: 0,
  });
}

// Several connections to the same Redis, used in turn. One connection tops out at a few thousand
// commands per second when the round trip is slow; a handful side by side removes that ceiling.
function makePool(size) {
  const clients = Array.from({ length: size }, (_, i) => make(`main${i}`, { commandTimeout: 2500 }));
  clients.forEach(defineScripts);
  let next = 0;
  return new Proxy(clients[0], {
    get(target, prop) {
      const v = target[prop];
      if (typeof v !== 'function') return v;
      // Custom commands must exist on every connection, since any of them may run the next call.
      if (prop === 'defineCommand') return (name, def) => clients.forEach((c) => c.defineCommand(name, def));
      // Connection-level calls go to the first connection, everything else is spread out.
      if (['quit', 'disconnect', 'duplicate', 'on', 'once', 'off', 'removeListener', 'status'].includes(prop)) return v.bind(target);
      return (...args) => {
        const c = clients[next++ % clients.length];
        return c[prop](...args);
      };
    },
  });
}

// Main connections for commands. Commands fail fast instead of hanging if Redis is down.
export const redis = makePool(Math.max(1, config.redisPool));
// Publisher and subscriber must be separate connections.
export const pub = make('pub', { commandTimeout: 2500 });
export const sub = make('sub');

export async function closeRedis() {
  await Promise.allSettled([redis.quit(), pub.quit(), sub.quit()]);
}
