import crypto from 'node:crypto';
import config from '../config.js';
import { redis } from '../redis.js';
import { Errors } from '../lib/errors.js';
import { leadingZeroBits } from '../lib/hash.js';

const TTL_SEC = 120;

// Busy IPs and subnets get harder puzzles, up to 4 extra bits.
async function extraBits(ip, subnet) {
  try {
    const p = redis.pipeline();
    p.incr(`powreq:ip:${ip}`).expire(`powreq:ip:${ip}`, 60, 'NX');
    p.incr(`powreq:net:${subnet}`).expire(`powreq:net:${subnet}`, 60, 'NX');
    const out = await p.exec();
    const ipCount = out[0][1];
    const netCount = out[2][1];
    return Math.min(4, Math.max(Math.floor(ipCount / 10), Math.floor(netCount / 100)));
  } catch {
    return 0;
  }
}

export async function issueChallenge(req, purpose) {
  const challengeId = crypto.randomBytes(16).toString('hex');
  const prefix = crypto.randomBytes(12).toString('hex');
  const difficulty = req.isTest
    ? config.testPowDifficulty
    : config.powDifficulty + (await extraBits(req.clientIp, req.subnet));
  const issuedAt = Date.now();
  await redis.set(
    `pow:${challengeId}`,
    JSON.stringify({ prefix, difficulty, issuedAt, ip: req.clientIp, purpose }),
    'EX', TTL_SEC,
  );
  return { challengeId, prefix, difficulty, expiresAt: new Date(issuedAt + TTL_SEC * 1000).toISOString() };
}

// Checks and uses up a solved puzzle. Returns how long the solve took on the server clock.
export async function verifyPow(pow, purpose, req) {
  if (!config.powEnabled) return null;
  if (!pow || typeof pow.challengeId !== 'string' || typeof pow.nonce !== 'string') throw Errors.powInvalid();
  if (!/^[a-f0-9]{32}$/.test(pow.challengeId) || !/^\d{1,20}$/.test(pow.nonce)) throw Errors.powInvalid();

  let raw;
  try {
    // Get-and-delete in one step, so a puzzle can never be used twice.
    raw = await redis.getdel(`pow:${pow.challengeId}`);
  } catch {
    throw Errors.busy();
  }
  if (!raw) throw Errors.powInvalid('The security check expired. Please try again.');

  const ch = JSON.parse(raw);
  if (ch.purpose !== purpose || ch.ip !== req.clientIp) throw Errors.powInvalid();

  const digest = crypto.createHash('sha256').update(ch.prefix + pow.nonce).digest();
  if (leadingZeroBits(digest) < ch.difficulty) throw Errors.powInvalid();

  // Remember how to put it back, in case a database hiccup stops the request that used it.
  req.powUndo = { key: `pow:${pow.challengeId}`, raw };
  return Math.max(0, Math.min(2_000_000_000, Date.now() - ch.issuedAt));
}

// A puzzle that was spent on a request that then failed for a temporary reason is given back for a
// short while, so the client's automatic retry with the same answer works instead of costing a new puzzle.
export async function undoPow(req) {
  if (!req.powUndo) return;
  await redis.set(req.powUndo.key, req.powUndo.raw, 'EX', 60).catch(() => {});
  req.powUndo = null;
}
