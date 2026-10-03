import nodemailer from 'nodemailer';
import config from '../config.js';
import logger from '../logger.js';
import { redis } from '../redis.js';

const QUEUE = 'mailq';
const MAX_QUEUE = 20000;
const MAX_ATTEMPTS = 3;

// Push only if the queue is not already huge (stops runaway memory use in Redis).
redis.defineCommand('mailPush', {
  numberOfKeys: 1,
  lua: `
    if redis.call('LLEN', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
    redis.call('LPUSH', KEYS[1], ARGV[1])
    return 1
  `,
});

const skipDomain = (to) => to.toLowerCase().endsWith('@fairdrop.test');

// Queues an email. Returns false if it was not queued; callers must never fail a request because of it.
export async function enqueueMail({ to, subject, text }) {
  if (skipDomain(to)) return true;
  try {
    const ok = await redis.mailPush(QUEUE, JSON.stringify({ to, subject, text, attempts: 0 }), MAX_QUEUE);
    return ok === 1;
  } catch (err) {
    logger.warn({ err: err.message }, 'could not queue email');
    return false;
  }
}

export const mailTemplates = {
  otp: (code) => ({
    subject: `Your Fair Drop code: ${code}`,
    text: `Your Fair Drop sign in code is ${code}.\n\nIt works for 10 minutes. If you did not ask for it, ignore this email.`,
  }),
  won: (dropName, dropId, confirmBy, minutes) => ({
    subject: `You won a seat: ${dropName}`,
    text: `Good news, you won a seat for ${dropName}.\n\nConfirm within ${minutes} minutes (by ${confirmBy.toUTCString()}) or the seat moves to the next person on the waitlist.\n\n${config.publicBaseUrl}/drops/${dropId}`,
  }),
  promoted: (dropName, dropId, confirmBy, minutes) => ({
    subject: `A seat opened up: ${dropName}`,
    text: `A seat opened up and you are next in line for ${dropName}.\n\nConfirm within ${minutes} minutes (by ${confirmBy.toUTCString()}) to keep it.\n\n${config.publicBaseUrl}/drops/${dropId}`,
  }),
};

let transport = null;
function getTransport() {
  if (!transport && config.smtp.host) {
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      pool: true,
      maxConnections: config.mailConcurrency,
    });
  }
  return transport;
}

async function deliver(job) {
  const t = getTransport();
  if (!t) {
    // No SMTP configured: outside production just log it so a developer can read the code.
    logger.info({ to: job.to, subject: job.subject, body: config.isProd ? undefined : job.text }, 'mail (smtp not configured)');
    return;
  }
  await t.sendMail({ from: config.smtp.from, to: job.to, subject: job.subject, text: job.text });
}

// Runs inside the worker. Each loop owns one blocking connection.
export function startMailConsumers(shouldStop) {
  const loops = [];
  for (let i = 0; i < config.mailConcurrency; i++) {
    loops.push(consumeLoop(shouldStop));
  }
  return Promise.all(loops);
}

async function consumeLoop(shouldStop) {
  const conn = redis.duplicate({ commandTimeout: undefined, maxRetriesPerRequest: null });
  conn.on('error', () => {});
  try {
    while (!shouldStop()) {
      let item;
      try {
        item = await conn.brpop(QUEUE, 2);
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      if (!item) continue;
      let job;
      try { job = JSON.parse(item[1]); } catch { continue; }
      try {
        await deliver(job);
      } catch (err) {
        job.attempts = (job.attempts || 0) + 1;
        if (job.attempts < MAX_ATTEMPTS) {
          logger.warn({ to: job.to, attempt: job.attempts, err: err.message }, 'mail failed, will retry');
          setTimeout(() => { redis.lpush(QUEUE, JSON.stringify(job)).catch(() => {}); }, 5000 * job.attempts);
        } else {
          logger.error({ to: job.to, err: err.message }, 'mail dropped after retries');
        }
      }
    }
  } finally {
    conn.disconnect();
  }
}
