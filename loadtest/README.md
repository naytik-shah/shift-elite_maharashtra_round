# Load tests (k6)

Two flash-crowd shapes, run from VM 2 against the backend on VM 1.

- `window-open.js`: puzzle, OTP login and entry for thousands of new users
- `results-reveal.js`: everyone polling `GET /drops/:dropId/entries/me` after the draw
- `sse-hold.mjs`: opens and holds SSE connections (k6 cannot hold a stream open)
- `lib.js`: shared helpers (puzzle solver, headers, metrics)

Every request sends `X-Test-Key` and its own `X-Test-Client-IP`. Never commit the key.

## Setup on VM 2

Install k6 for Linux from the k6 docs, and Node 18 or newer for the SSE script.
Before a big run raise the file limit: `ulimit -n 100000`.

Set `TEST_POW_DIFFICULTY` low on the backend for load runs, otherwise the test
measures VM 2's CPU solving puzzles instead of the backend.

## 1. Window open burst

Create a drop first and note its id.

```bash
k6 run \
  -e BASE_URL=http://<VM1_INTERNAL_IP>:<PORT> \
  -e TEST_KEY=<TEST_KEY> \
  -e DROP_ID=<DROP_ID> \
  -e USERS=5000 \
  -e DURATION_S=180 \
  -e EXPORT_SESSIONS=1 \
  --log-output=file=sessions.log --log-format raw \
  --summary-export=window-open-summary.json \
  loadtest/window-open.js
```

`USERS` is the total number of new users (each logs in and enters once).
Raise it step by step: 5000, 10000, 25000, 50000.
`sessions.log` holds session ids for the reveal test, so do not commit it.

## 2. Close, score, draw

Do this through the organiser endpoints (or the simulator).

## 3. Results reveal burst

```bash
k6 run \
  -e BASE_URL=http://<VM1_INTERNAL_IP>:<PORT> \
  -e TEST_KEY=<TEST_KEY> \
  -e DROP_ID=<DROP_ID> \
  -e SESSIONS_FILE=/full/path/to/sessions.log \
  -e USERS=5000 \
  -e DURATION_S=120 \
  --summary-export=results-reveal-summary.json \
  loadtest/results-reveal.js
```

Run the SSE holder at the same time in another terminal:

```bash
BASE_URL=http://<VM1_INTERNAL_IP>:<PORT> \
SSE_PATH=/api/v1/drops/<DROP_ID>/events \
TEST_KEY=<TEST_KEY> \
SESSIONS_FILE=/full/path/to/sessions.log \
CONNECTIONS=5000 node loadtest/sse-hold.mjs
```

## What to record

- p95 and p99 latency per step (`http_req_duration{step:entry}`, `{step:status}`)
- `errors_5xx` and `server_errors` (5xx only, 429 is not an error)
- `rate_limited_requests` (intended 429s)
- throughput (`http_reqs` rate)
- `dropped_iterations`: if above 0, VM 2 ran out of VUs, so the real limit is not the backend
- SSE: connected count, failed, dropped early, connect p95
- highest `USERS` value that passed, and VM 1 specs
