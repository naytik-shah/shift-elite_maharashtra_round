// All settings come from environment variables (see .env.example).
const env = process.env;

const int = (name, def) => {
  const v = env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
};
const bool = (name, def) => {
  const v = env[name];
  if (v === undefined || v === '') return def;
  return v === 'true' || v === '1';
};

const nodeEnv = env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

const config = {
  nodeEnv,
  isProd,
  port: int('PORT', 3000),
  databaseUrl: env.DATABASE_URL || 'postgres://fairdrop:fairdrop@localhost:5432/fairdrop',
  dbPoolMax: int('DB_POOL_MAX', 30),
  dbAcquireTimeoutMs: int('DB_ACQUIRE_TIMEOUT_MS', 5000),
  redisUrl: env.REDIS_URL || 'redis://localhost:6379',
  redisPool: int('REDIS_POOL', 3),
  sessionSecret: env.SESSION_SECRET || '',
  anchorPepper: env.ANCHOR_PEPPER || '',
  cookieSecure: bool('COOKIE_SECURE', isProd),
  publicBaseUrl: env.PUBLIC_BASE_URL || 'http://localhost:3000',
  dropsConfigPath: env.DROPS_CONFIG_PATH || '../config/drops.yaml',
  disposableDomainsPath: env.DISPOSABLE_DOMAINS_PATH || '../config/disposable-domains.txt',
  testKey: env.TEST_KEY || '',
  powDifficulty: int('POW_DIFFICULTY', 18),
  testPowDifficulty: int('TEST_POW_DIFFICULTY', 8),
  // Demo only. A fixed six digit code that signs in participants and the dummy organiser. Empty switches it off.
  demoBypassCode: /^\d{6}$/.test(env.DEMO_BYPASS_CODE || '') ? env.DEMO_BYPASS_CODE : '',
  // Demo tools for the organiser: add an event, reset every event, send a simulated crowd. Off unless set.
  demoTools: bool('DEMO_TOOLS', false),
  powEnabled: bool('POW_ENABLED', true),
  rateLimitsEnabled: bool('RATE_LIMITS_ENABLED', true),
  smtp: {
    host: env.SMTP_HOST || '',
    port: int('SMTP_PORT', 465),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'Fair Drop <no-reply@fairdrop.local>',
  },
  scoringUrl: env.SCORING_URL || '',
  workerIntervalMs: int('WORKER_INTERVAL_MS', 10000),
  mailConcurrency: int('MAIL_CONCURRENCY', 4),
  logLevel: env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  // Limits from PRD 9.4. Every one can be tuned without a code change.
  limits: {
    ipAllPerMin: int('RL_IP_ALL_PER_MIN', 60),
    subnetAllPerMin: int('RL_SUBNET_ALL_PER_MIN', 600),
    ipOtpRequest: int('RL_IP_OTP_REQUEST', 5),
    emailOtpRequest: int('RL_EMAIL_OTP_REQUEST', 3),
    ipOtpVerify: int('RL_IP_OTP_VERIFY', 20),
    sessionEntryPerMin: int('RL_SESSION_ENTRY_PER_MIN', 5),
    sessionConfirmPerMin: int('RL_SESSION_CONFIRM_PER_MIN', 10),
    sessionStatusPerMin: int('RL_SESSION_STATUS_PER_MIN', 120),
  },
};

export function assertConfig() {
  const problems = [];
  if (!config.sessionSecret || config.sessionSecret.length < 16) problems.push('SESSION_SECRET must be set (16+ characters)');
  if (!config.anchorPepper || config.anchorPepper.length < 16) problems.push('ANCHOR_PEPPER must be set (16+ characters)');
  if (config.testKey && config.testKey.length < 16) problems.push('TEST_KEY must be 16+ characters (or empty to disable test access)');
  if (problems.length) throw new Error(`Bad configuration: ${problems.join('; ')}`);
}

export default config;
