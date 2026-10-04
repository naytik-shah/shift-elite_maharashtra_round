// Opens many SSE connections and holds them, since k6 http cannot keep a stream open.
// Usage: BASE_URL=http://<ip>:<port> SSE_PATH=/api/v1/drops/<id>/events TEST_KEY=... \
//        SESSIONS_FILE=sessions.log CONNECTIONS=5000 node loadtest/sse-hold.mjs
import http from 'node:http';
import fs from 'node:fs';

const base = new URL(process.env.BASE_URL || 'http://localhost:3000');
const path = process.env.SSE_PATH;
const key = process.env.TEST_KEY;
const file = process.env.SESSIONS_FILE || 'sessions.log';
const total = parseInt(process.env.CONNECTIONS || '5000', 10);
const rampS = parseInt(process.env.RAMP_S || '30', 10);
const holdS = parseInt(process.env.HOLD_S || '60', 10);

if (!path || !key) {
  console.error('Set SSE_PATH and TEST_KEY');
  process.exit(1);
}

const sessions = [];
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  const at = line.indexOf('{');
  if (at < 0) continue;
  try {
    const s = JSON.parse(line.slice(at));
    if (s.sid && s.ip) sessions.push(s);
  } catch {
    // not a session line
  }
}
if (sessions.length === 0) {
  console.error(`No sessions found in ${file}`);
  process.exit(1);
}

const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });
const stats = { attempted: 0, connected: 0, failed: 0, droppedEarly: 0, chunks: 0, status: {} };
const ttfb = [];
let finished = false;

function openOne(s) {
  stats.attempted++;
  const t0 = Date.now();
  const req = http.get(
    {
      host: base.hostname,
      port: base.port || 80,
      path,
      agent,
      headers: {
        Accept: 'text/event-stream',
        Cookie: `sid=${s.sid}`,
        'X-Test-Key': key,
        'X-Test-Client-IP': s.ip,
      },
    },
    (res) => {
      stats.status[res.statusCode] = (stats.status[res.statusCode] || 0) + 1;
      if (res.statusCode !== 200) {
        stats.failed++;
        res.resume();
        return;
      }
      stats.connected++;
      ttfb.push(Date.now() - t0);
      res.on('data', () => stats.chunks++);
      res.on('close', () => {
        if (!finished) stats.droppedEarly++;
      });
    }
  );
  req.on('error', () => {
    stats.failed++;
  });
}

for (let i = 0; i < total; i++) {
  const s = sessions[i % sessions.length];
  setTimeout(() => openOne(s), (i / total) * rampS * 1000);
}

setTimeout(() => {
  finished = true;
  ttfb.sort((a, b) => a - b);
  const pct = (p) => (ttfb.length ? ttfb[Math.min(ttfb.length - 1, Math.floor(ttfb.length * p))] : null);
  const errors5xx = Object.entries(stats.status)
    .filter(([code]) => Number(code) >= 500)
    .reduce((n, [, c]) => n + c, 0);
  console.log(
    JSON.stringify({ ...stats, errors5xx, connectMsP95: pct(0.95), connectMsP99: pct(0.99) }, null, 2)
  );
  agent.destroy();
  process.exit(0);
}, (rampS + holdS) * 1000);
