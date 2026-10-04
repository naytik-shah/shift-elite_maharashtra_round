import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';

// Finds a decimal nonce so sha256(prefix + nonce) has `difficulty` leading zero bits.
export function solvePow(prefix, difficulty, maxTries = 50_000_000) {
  for (let n = 0; n < maxTries; n++) {
    const d = crypto.createHash('sha256').update(prefix + n).digest();
    let bits = 0;
    for (let i = 0; i < d.length; i++) {
      if (d[i] === 0) {
        bits += 8;
        continue;
      }
      bits += Math.clz32(d[i]) - 24;
      break;
    }
    if (bits >= difficulty) return n;
  }
  return null;
}

export function sidCookie(setCookie) {
  const found = [].concat(setCookie || []).find((c) => c.startsWith('sid='));
  return found ? found.split(';')[0] : null;
}

export class Api {
  constructor({ baseUrl, testKey, stats, timeoutMs = 30000, maxSockets = 1000 }) {
    this.url = new URL(baseUrl);
    this.mod = this.url.protocol === 'https:' ? https : http;
    this.agent = new this.mod.Agent({ keepAlive: true, maxSockets });
    this.testKey = testKey;
    this.stats = stats;
    this.timeoutMs = timeoutMs;
  }

  req(method, path, { user, ip, body, tag = 'other', timeoutMs } = {}) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      let payload = null;
      if (method !== 'GET') payload = JSON.stringify(body === undefined ? {} : body);

      const headers = {
        'X-Test-Key': this.testKey,
        'X-Test-Client-IP': ip || user?.ip || '198.51.100.1',
      };
      if (payload !== null) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
        headers['Idempotency-Key'] = crypto.randomUUID();
      }
      if (user?.cookie) headers.Cookie = user.cookie;

      const done = (out) => {
        this.stats.record(tag, out);
        resolve(out);
      };

      const req = this.mod.request(
        {
          hostname: this.url.hostname,
          port: this.url.port || (this.url.protocol === 'https:' ? 443 : 80),
          path: '/api/v1' + path,
          method,
          headers,
          agent: this.agent,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            let parsed = null;
            try {
              parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
              parsed = null;
            }
            done({ status: res.statusCode, body: parsed, headers: res.headers, ms: Date.now() - t0 });
          });
        }
      );
      req.setTimeout(timeoutMs || this.timeoutMs, () => req.destroy(new Error('timeout')));
      req.on('error', () => done({ status: 0, body: null, headers: {}, ms: Date.now() - t0 }));
      if (payload !== null) req.write(payload);
      req.end();
    });
  }
}
