import { sleep } from 'k6';
import exec from 'k6/execution';
import {
  get,
  post,
  track,
  solvePow,
  ipFor,
  randomFp,
  burstStages,
  requireEnv,
  summaryTrendStats,
  DROP_ID,
} from './lib.js';

const USERS = parseInt(__ENV.USERS || '5000', 10);
const DURATION_S = parseInt(__ENV.DURATION_S || '180', 10);
const MAX_VUS = parseInt(__ENV.MAX_VUS || '8000', 10);
const EXPORT_SESSIONS = __ENV.EXPORT_SESSIONS === '1';

export const options = {
  scenarios: {
    window_open_burst: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: MAX_VUS,
      stages: burstStages(USERS, DURATION_S),
    },
  },
  thresholds: {
    'http_req_duration{step:entry}': ['p(95)<2000', 'p(99)<5000'],
    server_errors: ['rate<0.01'],
    dropped_iterations: ['count<1'],
  },
  summaryTrendStats,
};

export function setup() {
  requireEnv();
}

export default function () {
  const idx = exec.scenario.iterationInTest;
  if (idx >= USERS) return;

  const ip = ipFor(idx);
  const email = `load${idx}@loadtest.example`;

  // log in: puzzle, otp request, verify
  const c1 = get('/pow/challenge?purpose=otp', ip, 'challenge');
  if (!track(c1, 'challenge')) return;
  const pow1 = solvePow(c1.json());
  if (!pow1) return;

  const otp = post('/auth/otp/request', { email, pow: pow1 }, ip, 'otp_request');
  if (!track(otp, 'otp_request')) return;

  let code;
  try {
    code = otp.json('devCode');
  } catch (e) {
    code = null;
  }
  if (!code) return;

  const verify = post('/auth/otp/verify', { email, code }, ip, 'otp_verify');
  if (!track(verify, 'otp_verify')) return;

  if (EXPORT_SESSIONS) {
    const jar = verify.cookies && verify.cookies.sid;
    if (jar && jar[0]) {
      console.log('SESSION ' + JSON.stringify({ sid: jar[0].value, ip }));
    }
  }

  // human pause before entering
  sleep(Math.random() * 3);

  const c2 = get('/pow/challenge?purpose=entry', ip, 'challenge');
  if (!track(c2, 'challenge')) return;
  const pow2 = solvePow(c2.json());
  if (!pow2) return;

  const entry = post(
    `/drops/${DROP_ID}/entries`,
    { pow: pow2, deviceFingerprint: randomFp() },
    ip,
    'entry'
  );
  track(entry, 'entry');
}
