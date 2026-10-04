import { sleep } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import {
  get,
  track,
  burstStages,
  requireEnv,
  parseSessions,
  summaryTrendStats,
  DROP_ID,
} from './lib.js';

const USERS = parseInt(__ENV.USERS || '5000', 10);
const DURATION_S = parseInt(__ENV.DURATION_S || '120', 10);
const MAX_VUS = parseInt(__ENV.MAX_VUS || '8000', 10);
const POLLS = parseInt(__ENV.POLLS || '3', 10);
const SESSIONS_FILE = __ENV.SESSIONS_FILE || 'sessions.log';

const sessions = new SharedArray('sessions', () => parseSessions(open(SESSIONS_FILE)));

export const options = {
  scenarios: {
    results_reveal_burst: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: MAX_VUS,
      stages: burstStages(USERS, DURATION_S),
    },
  },
  thresholds: {
    'http_req_duration{step:status}': ['p(95)<1000', 'p(99)<3000'],
    server_errors: ['rate<0.01'],
    dropped_iterations: ['count<1'],
  },
  summaryTrendStats,
};

export function setup() {
  requireEnv();
  if (sessions.length === 0) {
    throw new Error(
      `No sessions found in ${SESSIONS_FILE}. Run window-open with EXPORT_SESSIONS=1 and --log-format raw.`
    );
  }
}

export default function () {
  const s = sessions[exec.scenario.iterationInTest % sessions.length];

  // each user polls a few times, like someone refreshing the results page
  for (let i = 0; i < POLLS; i++) {
    const res = get(`/drops/${DROP_ID}/entries/me`, s.ip, 'status', {
      Cookie: `sid=${s.sid}`,
    });
    track(res, 'status');
    if (i < POLLS - 1) sleep(2);
  }
}
