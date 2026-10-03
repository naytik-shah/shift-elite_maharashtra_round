# Backend handoff (4 Oct 2026)

Everything needed to pick up the backend on another machine. Read this first, then `docs/MVP.md`, `docs/TRD.md`
and `server/README.md`. If this file and the PRD disagree on behaviour, the PRD wins.

## 1. Ground rules for this repo (important)

- **Never push without Naytik's explicit OK for that specific push.** Commit locally, then ask.
- **The repo is watched by hackathon moderators.** Commits are authored by team members only: no tool names, no
  attribution or co-author trailers, no "made with" notes anywhere (files, comments, commit messages, branch names,
  PR text). Write like a normal student developer, and check staged files before every commit.
- No em dashes or en dashes anywhere (team style). Use commas, colons, brackets or plain hyphens.
- Commit messages: short, lowercase, natural ("add waitlist worker", "fix status cache after draw").
- Ownership: Naytik owns `/server`, `/deploy`, `/config`, `/scripts`. Jash owns `/frontend`. Zeal owns the simulator,
  k6 and the scoring model. Do not edit `/frontend`; write API notes for Jash instead.
- Secrets live only in `server/.env` and `deploy/.env` (both gitignored). Never commit them.

## 2. Where things stand

The MVP backend from `docs/MVP.md` is built and tested end to end, including several post-MVP items (worker, live
updates, proof-of-work, rate limits, audit log, emails, dashboard endpoints, simulator results upload).

| Area | State |
|---|---|
| Login (email code, proof-of-work, sessions) | Done |
| Entries (one per person, window check, close race safe) | Done |
| Close, draw (weighted, verifiable), manifest, results | Done |
| Confirm (one card per seat, deadline on the DB clock) | Done |
| Worker: expiry, waitlist promotion, unfilled seats, completion | Done |
| Live updates over SSE with Redis pub/sub fan-out | Done |
| Rate limits, idempotency, test access (`X-Test-Key`) | Done |
| Hash-chained audit log | Done |
| Emails (Gmail SMTP via queue in Redis, sent by the worker) | Done, untested against real Gmail (no credentials yet) |
| Organiser endpoints: live counts, slots, audit, runs upload | Done |
| Scoring call (`POST /admin/drops/:id/score`) | Built but only enabled when `SCORING_URL` is set (Zeal's service) |
| Flags endpoints (`/admin/drops/:id/flags...`) | **Not built** (need Zeal's `risk_signals` data first) |
| Docker stack: nginx, 2 APIs, worker, Postgres, Redis | Done (`deploy/`) |
| Google Cloud VMs, HTTPS (certbot on sslip.io) | **Not done** |

## 3. Test results (all on one Windows laptop, Docker Desktop)

| Test | Result |
|---|---|
| `scripts/mvp-smoke-test.mjs` (100 users) | 26 passed, 0 failed, 1 skipped (scoring, not enabled) |
| `scripts/edge-tests.mjs` | 48 / 48 |
| `scripts/expiry-test.mjs` | 2 / 2 (deadline races with two workers, full expiry chain) |
| `scripts/resilience-test.mjs` | 6 / 6 (Redis down, Postgres down, one API restarted mid-traffic) |
| `scripts/load-test.mjs`, **50,000 users** | All checks passed (details below) |

Final 50,000 user run (inside the Docker network, 800 requests in flight):

- 50,000 / 50,000 signed in and entered, 0 server errors in 300,988 requests.
- Draw over 50,000 entries: 7.2 s. Reproduced independently from the public seed and manifest: identical.
- 5,000 open live streams all received their result (about 7 s after the draw click, i.e. right after the draw finished).
- 50,000 status reads: 0 wrong answers. p50 0.55 s, p95 2.6 s, p99 8 s at 1,118 req/s (the laptop was saturated).
- 500 winners: 20 shared cards let exactly 20 confirm (480 blocked), then 480 / 480 confirmed with their own cards.
- Database invariants (no oversell, no card on two seats, no user with two entries, tickets = confirmed seats,
  waitlist order intact): no violations.
- Entry p95 0.8 s, login steps p95 about 1.2 s.

These numbers are limited by the laptop (load generator, nginx, two APIs, Postgres and Redis sharing 6 cores under
WSL2). The real target is an e2-standard-4 VM; re-measure there.

## 4. How to run it on a new machine

Needs Node 20+ and Docker.

```bash
# 1. dependencies
cd server && npm install && cd ../scripts && npm install && cd ..

# 2a. quick dev mode: Postgres + Redis in Docker, API and worker as plain node processes
docker compose -f deploy/docker-compose.dev.yml up -d          # Postgres 127.0.0.1:5433, Redis 127.0.0.1:6380
cp server/.env.example server/.env                              # fill SESSION_SECRET, ANCHOR_PEPPER, TEST_KEY
# for the test scripts also set DROPS_CONFIG_PATH=../config/drops.yaml,../config/drops.test.yaml
cd server && node --env-file=.env src/index.js                  # and in a 2nd terminal: node --env-file=.env src/worker.js

# 2b. full stack (what production looks like)
cp deploy/.env.example deploy/.env                              # fill secrets, HTTP_PORT=8080 locally, COOKIE_SECURE=false on http
COMPOSE_EXTRA="-f deploy/docker-compose.expose.yml" deploy/up.sh
# expose.yml publishes Postgres on 127.0.0.1:5434 and Redis on 127.0.0.1:6381 for the test scripts. Never on the VM.
```

Make secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. `TEST_KEY` must be
16+ characters. Ports 5433/6380 were chosen because 5432 was taken on the old machine; change them if needed.

Running the tests (from `scripts/`, with `TEST_KEY` set to the server's key):

```bash
# against the full stack
export BASE_URL=http://localhost:8080/api/v1 DATABASE_URL=postgres://fairdrop:fairdrop@127.0.0.1:5434/fairdrop REDIS_URL=redis://127.0.0.1:6381
DROP_ID=smoke-test node reset-drop.mjs && DROP_ID=smoke-test USERS=100 node mvp-smoke-test.mjs
node edge-tests.mjs
node resilience-test.mjs        # stops and starts containers of the stack, full stack only
node expiry-test.mjs            # best with fast worker ticks: WORKER_INTERVAL_MS=300
# load test from inside the Docker network (realistic numbers):
USERS=50000 CONC=800 THREADS=4 SSE_USERS=5000 STATUS_CONC=1000 scripts/run-in-docker.sh load-test.mjs
```

The test drops in `config/drops.test.yaml` (`test-edge`, `test-race`, `test-empty`, `test-future`, `test-past`,
`test-expire`, `test-load`, `test-live`) must be loaded for the scripts; they must **not** be loaded on the public VM.
Each script resets the drops it uses. The smoke test needs `reset-drop.mjs` first. The `smoke-test` drop window is
only 4 Oct 2026 (IST), so move its dates in `config/drops.yaml` if testing on another day (only new drop ids are
created; an existing drop is never updated from the file, so also delete or rename it in the database).

Windows notes: `scripts/dev-restart.ps1 -Apis 2 -Workers 2 -WorkerIntervalMs 300` restarts local node processes.
In Git Bash, `docker run -w /work` paths get rewritten unless `MSYS_NO_PATHCONV=1` (the scripts set it).

## 5. Design decisions and changes from the TRD

Code is in `server/src`. Things that differ from what the TRD says, and why:

1. **Sessions**: a small custom layer (`middleware/session.js`) instead of `express-session` + `connect-redis`. The
   cookie `sid` is a random 256-bit id (nothing to sign), data in Redis `sess:<id>` for 7 days, new id at every
   login, old one deleted. HttpOnly, SameSite=Lax, Secure when `COOKIE_SECURE=true`. It was about 30% of the CPU
   per request before. If Redis is down, public reads still work and logged-in requests get 503.
2. **Rate limits**: own fixed-window counters in one Lua script (`rlTake` in `redis.js`) instead of
   `rate-limiter-flexible`. All limits for a request (IP, /24 subnet, and the per-person limit for status, entry or
   confirm) are taken in a single Redis call in `middleware/rateLimit.js`. Limits are the PRD 9.4 defaults, all
   overridable with `RL_*` env vars. Writes fail closed if Redis is down, reads fail open. Confirm has its own
   per-person limit (10/min) so it does not share the entry limit.
3. **Removed `pino-http` and `helmet`**: replaced by `middleware/requestLog.js` (logs only 5xx and requests over 2 s,
   so an attack cannot flood the logs) and `middleware/securityHeaders.js`.
4. **Waitlist position** is `rank - drops.cursor_rank` (new column). Promotion always takes the smallest waiting rank,
   so this equals "waitlisted entries with a smaller rank + 1" and costs nothing to compute at 50k users.
5. **Entry insert is one statement** (`INSERT ... SELECT ... FROM drops ... FOR SHARE OF d ON CONFLICT DO NOTHING`).
   The `FOR SHARE` lock makes close wait for in-flight entries, so nothing commits after close (tested with 150
   simultaneous entries racing a close).
6. **Status reads** use a 1.5 s in-process cache per API process (not Redis). It is cleared through the pub/sub
   events: a draw or completion bumps a per-drop version, a confirm/expiry/promotion clears that one person.
   "Not entered" is never cached.
7. **SSE**: one Redis `psubscribe` (`drop:*`, `user:*`) per API process. After the draw each process pushes fresh
   statuses to its own connected users in batches of 500 (one SQL query per batch). Extra events beyond the MVP list:
   `waitlist_moved`, `manifest_published`, `draw_complete` (Jash's client already listens for them). After a Redis
   reconnect, each process resends the drop state and statuses from Postgres. Max 5 streams per person per process.
8. **Worker**: advisory lock 2, locks the seat row first (same order as confirm, so they can never deadlock), uses
   `FOR UPDATE SKIP LOCKED` on the slot so a confirm in progress is never expired under it. Emails go through a Redis
   list `mailq` with retries; email failures never block anything.
9. **Retry safety**: if a temporary DB failure happens after a puzzle or a login code was used up, it is put back for
   60 s so the client's automatic retry works (this was the cause of 3% lost users in the first 50k run).
10. **Multiple drop config files**: `DROPS_CONFIG_PATH` accepts a comma separated list (used for the test drops).
11. **Errors**: DB/Redis connection problems (including DNS failures when a container is down) become 503
    `SERVICE_BUSY` with `Retry-After`, never 500. Pool: 30 connections per process, 5 s acquire timeout.
12. **nginx**: static upstream with keepalive, `proxy_next_upstream` for reads, SSE location unbuffered. nginx resolves
    `api1`/`api2` only at start or reload, so `deploy/up.sh` reloads it after every update. Do not add
    `restart: true` to its `depends_on` (it took the whole site down whenever one API restarted).
13. Draw endpoint returns 404 for manifest/results before the draw. `GET /tickets/me` added. Drops can carry optional
    `category`, `venue`, `city`, `description`, `event_at` in the YAML (Jash's pages use them).

## 6. Known problems and next steps (in priority order)

1. **Deploy to Google Cloud** (TRD section 4): VM 1 with `deploy/up.sh` (no expose file, `HTTP_PORT=80`), certbot on
   `<ip-with-dashes>.sslip.io`, `COOKIE_SECURE=true`. nginx config currently only listens on 80; add the 443 server
   block after certbot. Keep `TEST_KEY` set for Zeal's simulator.
2. **Frontend contract mismatches** (tell Jash, branch `origin/frontend-ui`): his client sends `paymentMethodToken` and
   calls `/payments/methods`, but the API takes `{ testCard, payerName }` on confirm (as in MVP.md). Ticket has both
   `slotNo` and `seatNo`. His `vite.config.ts` proxies `/api` to port 8000; the API runs on 3000 (or nginx on 80).
   Drop states in his types include ANNOUNCED/SCORING/CONFIRMING, which the backend never sends.
3. **Scoring**: when Zeal's service exists, set `SCORING_URL`; the endpoint, the "draw blocked while scoring" rule and
   the audit row are already in place. Then build `/admin/drops/:id/flags` and `/flags/:entryId` from `risk_signals`.
4. **Draw time**: about 3 s idle and 7 to 10 s under load for 50k entries, mostly the bulk `UPDATE` (every row
   rewrites 5 indexes because `state` and `rank` are indexed). Acceptable for a one-off organiser action, but the
   live push waits for it.
5. **Status latency during the reveal burst** misses the PRD target (p95 < 200 ms) on the laptop. Most people get
   their result over SSE instead of polling, and the VM is faster; re-measure there. More API replicas are easy
   (add `api3` in compose and the nginx upstream).
6. Confirm bursts queue on the audit advisory lock (lock 3) while holding a DB connection. Fine at 500 seats.
7. Real email via Gmail SMTP is untested (needs an app password in `deploy/.env`).
8. Unit tests for pure functions (draw algorithm, email normalising, subnet) do not exist yet; everything is covered
   by the integration scripts instead.

## 7. File map

```
server/src/index.js, worker.js      entry points
server/src/app.js                   middleware order: requestLog, securityHeaders, health, clientIp, testAccess,
                                    loadSession, requestLimits, content-type check, JSON body, routes, errors
server/src/routes/                  auth.js, drops.js (drop info, draw data, SSE, status, tickets), entries.js
                                    (enter, confirm), admin.js
server/src/services/                draw.js (close + draw), drawAlgo.js (pure ranking), confirm.js, waitlist.js
                                    (worker tick), events.js (SSE hub), status.js, audit.js, pow.js, mailer.js,
                                    payments.js, dropsLoader.js, dropsRepo.js, stats.js, migrate.js
server/migrations/001_init.sql      schema (TRD section 5 plus cursor_rank and the optional event fields)
deploy/                             docker-compose.yml, docker-compose.dev.yml, docker-compose.expose.yml,
                                    nginx.conf, up.sh, .env.example
config/                             drops.yaml (real), drops.test.yaml (tests only), disposable-domains.txt
scripts/                            lib.mjs (helpers), invariants.mjs, smoke/edge/expiry/resilience/load tests,
                                    load-core.mjs + load-worker.mjs (threaded load generator), reset-drop.mjs,
                                    run-in-docker.sh, dev-restart.ps1
```
