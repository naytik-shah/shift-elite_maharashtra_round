import crypto from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import config from '../config.js';
import { pool } from '../db.js';
import { redis } from '../redis.js';
import { Errors } from '../lib/errors.js';
import { hmacSha256, safeEqual } from '../lib/hash.js';
import { normaliseEmail, emailDomain } from '../lib/email.js';
import { issueChallenge, verifyPow } from '../services/pow.js';
import { isOrganiserEmail, isDisposableDomain } from '../services/dropsLoader.js';
import { enqueueMail, mailTemplates } from '../services/mailer.js';
import { limitOtpRequestIp, limitOtpRequestEmail, limitOtpVerifyIp } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import { createSession, destroySession } from '../middleware/session.js';

const router = express.Router();

const powSchema = z.object({ challengeId: z.string().max(64), nonce: z.string().max(24) }).optional();
const emailSchema = z.string().trim().min(3).max(254);
// Built once: creating a schema is far more expensive than using one.
const otpRequestSchema = z.object({ email: emailSchema, pow: powSchema });
const otpVerifySchema = z.object({ email: emailSchema, code: z.string().trim().regex(/^\d{6}$/) });

const OTP_TTL_SEC = 600;
const OTP_MAX_ATTEMPTS = 5;

router.get('/pow/challenge', async (req, res) => {
  const purpose = req.query.purpose;
  if (purpose !== 'otp' && purpose !== 'entry') throw Errors.validation('purpose must be "otp" or "entry".');
  res.set('Cache-Control', 'no-store').json(await issueChallenge(req, purpose));
});

router.post('/auth/otp/request', async (req, res) => {
  const body = otpRequestSchema.parse(req.body ?? {});
  const norm = normaliseEmail(body.email);
  if (!norm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm)) throw Errors.validation('Enter a valid email address.');
  if (isDisposableDomain(emailDomain(norm))) throw Errors.validation('Please use a permanent email address, not a disposable one.');

  await limitOtpRequestIp(req);
  // Puzzle before the per-email limit, so strangers cannot burn someone else's quota for free.
  await verifyPow(body.pow, 'otp', req);
  await limitOtpRequestEmail(norm);

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = hmacSha256(config.sessionSecret, `${norm}|${code}`);
  await redis.set(`otp:${norm}`, JSON.stringify({ codeHash, attempts: 0 }), 'EX', OTP_TTL_SEC);

  if (req.isTest) {
    res.status(202).json({ devCode: code });
    return;
  }
  const mail = mailTemplates.otp(code);
  const queued = await enqueueMail({ to: body.email.trim(), ...mail });
  if (!queued) throw Errors.busy(5);
  res.status(202).json({});
});

async function upsertUser(email, norm, role) {
  let r = await pool.query('SELECT id, email, role FROM users WHERE normalised_email = $1', [norm]);
  if (!r.rowCount) {
    r = await pool.query(
      `INSERT INTO users (email, normalised_email, role) VALUES ($1, $2, $3)
       ON CONFLICT (normalised_email) DO NOTHING RETURNING id, email, role`,
      [email, norm, role],
    );
    if (!r.rowCount) r = await pool.query('SELECT id, email, role FROM users WHERE normalised_email = $1', [norm]);
  }
  const user = r.rows[0];
  if (user.role !== role) {
    await pool.query('UPDATE users SET role = $2 WHERE id = $1', [user.id, role]);
    user.role = role;
  }
  return user;
}

// Demo only (DEMO_BYPASS_CODE). Never for a real organiser: the only organiser it can open is the dummy
// @fairdrop.test account. Participants are signed in as normal, with the usual rate limit on verify.
function demoBypass(code, norm) {
  if (!config.demoBypassCode || !safeEqual(code, config.demoBypassCode)) return false;
  return !isOrganiserEmail(norm) || emailDomain(norm) === 'fairdrop.test';
}

router.post('/auth/otp/verify', async (req, res) => {
  await limitOtpVerifyIp(req);
  const body = otpVerifySchema.parse(req.body ?? {});
  const norm = normaliseEmail(body.email);
  if (!norm) throw Errors.otpInvalid();

  const codeHash = hmacSha256(config.sessionSecret, `${norm}|${body.code}`);
  if (!demoBypass(body.code, norm)) {
    const outcome = await redis.otpCheck(`otp:${norm}`, codeHash, OTP_MAX_ATTEMPTS);
    if (outcome === 'locked') throw Errors.otpLocked();
    if (outcome !== 'ok') throw Errors.otpInvalid();
  }

  let user;
  try {
    user = await upsertUser(body.email.trim(), norm, isOrganiserEmail(norm) ? 'organiser' : 'participant');
    // A fresh session id at every login stops session fixation.
    await createSession(req, res, { userId: user.id, email: user.email, role: user.role });
  } catch (err) {
    // The code was already used up. If the failure is temporary, give it back for a minute so the
    // client's retry with the same code works.
    await redis.set(`otp:${norm}`, JSON.stringify({ codeHash, attempts: 0 }), 'EX', 60).catch(() => {});
    throw err;
  }

  res.json({ user: { id: user.id, email: user.email, role: user.role } });
});

router.post('/auth/logout', async (req, res) => {
  await destroySession(req, res);
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store').json({ id: req.session.userId, email: req.session.email, role: req.session.role });
});

export default router;
