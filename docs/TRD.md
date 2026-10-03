# Fair Drop: Technical Requirements Document

**Team:** Naytik Shah (Backend), Jash Madhani (Frontend), Zeal Shah (Bot defence and adversarial testing)
**Version:** v1.0, 4 Oct 2026
**Scope:** everything in `docs/MVP.md` (by H2) and the full product (by H5). Product behaviour is defined in `docs/PRD.md`; this document defines how it is built. If they disagree, the PRD wins on behaviour and this document wins on implementation.

---

## 1. Technical decisions

| Area | Decision | Why |
|---|---|---|
| Backend language | Node.js 20, plain JavaScript, ES modules | Fast to write, same language as the simulator |
| HTTP framework | Express | Simple, well known |
| Database access | `pg` with raw SQL, plain `.sql` migrations run at startup | The overselling protection is plain SQL; keep it visible |
| Cache and coordination | Redis 7 with `ioredis` | Sessions, rate limits, puzzles, pub/sub |
| Sessions | `express-session` + `connect-redis` | Server-side, revocable |
| Rate limits | `rate-limiter-flexible` (Redis) | Battle-tested token buckets |
| Validation | `zod` | Short, readable request schemas |
| Logging | `pino` | Fast JSON logs |
| Email | `nodemailer` with Gmail SMTP and an app password | Free, a few hundred emails a day is enough for the demo |
| Frontend | React 18 + Vite, `js-sha256` | Fast sync hashing for puzzles and the verify page |
| Scoring service | Python 3.11, FastAPI, scikit-learn, psycopg | Zeal's model, small HTTP wrapper |
| Simulator | Node.js 20 | Reuses smoke test helpers |
| Load test | k6 | Free, scriptable |
| Hosting | 2 Google Cloud VMs (e2-standard-4, asia-south1), Docker Compose | Server and attacker on separate machines |
| HTTPS | nginx + certbot on an `sslip.io` hostname | Free certificate without buying a domain |

## 2. Repository layout

```
/server            Naytik    API and worker (one codebase, two entry points)
  /src
    app.js           Express app setup and middleware order
    index.js         API entry point
    worker.js        Worker entry point
    config.js        Environment variables
    db.js            pg pool and transaction helper
    redis.js         ioredis clients (main, publisher, subscriber)
    /middleware      clientIp, testAccess, rateLimit, auth, idempotency, errors
    /routes          auth, drops, entries, draw, admin, events, runs
    /services        otp, pow, mailer, payments, draw, audit, scoringClient, dropsLoader
    /lib             email normalise, hashing, errors
  /migrations        001_init.sql, 002_...sql
/web               Jash      React app
/sim               Zeal      bot simulator
/load              Zeal      k6 scripts
/scoring           Zeal      Python scoring service and model
/scripts                     mvp-smoke-test.mjs
/config                      drops.yaml, disposable-domains.txt
/deploy                      nginx.conf, docker-compose.yml, docker-compose.attacker.yml
/docs                        PRD.md, TRD.md, MVP.md
```

Each person only edits their own folders. Changes to the API, schema or config go through Naytik.

## 3. Environment variables

| Variable | Used by | Example | Notes |
|---|---|---|---|
| `NODE_ENV` | api, worker | `production` | |
| `PORT` | api | `3000` | |
| `DATABASE_URL` | api, worker, scoring | `postgres://fairdrop:...@postgres:5432/fairdrop` | |
| `DB_POOL_MAX` | api, worker | `20` | Per process |
| `REDIS_URL` | api, worker | `redis://redis:6379` | |
| `SESSION_SECRET` | api | 64 random hex chars | |
| `ANCHOR_PEPPER` | api | 64 random hex chars | Key for card hashes |
| `COOKIE_SECURE` | api | `true` | `false` only if HTTPS setup fails |
| `PUBLIC_BASE_URL` | api, worker | `https://34-93-10-20.sslip.io` | Used in emails |
| `DROPS_CONFIG_PATH` | api | `/app/config/drops.yaml` | |
| `TEST_KEY` | api | 32 random hex chars | Empty disables test access |
| `POW_DIFFICULTY` | api | `18` | Base bits for normal users |
| `TEST_POW_DIFFICULTY` | api | `8` | For requests with a valid test key |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | worker, api | Gmail SMTP, port 465 | App password, never committed |
| `SCORING_URL` | api | `http://scoring:8000` | |
| `WORKER_INTERVAL_MS` | worker | `10000` | |

Secrets live in a `.env` file on the VM that is listed in `.gitignore`. Commit a `.env.example` with placeholder values only.

## 4. Infrastructure

### 4.1 VMs
| VM | Type | Runs |
|---|---|---|
| VM 1 `fairdrop-app` | e2-standard-4 (4 vCPU, 16 GB), Ubuntu 24.04, 50 GB disk | nginx, api x2, worker, scoring, postgres, redis |
| VM 2 `fairdrop-attack` | e2-standard-4, same zone | simulator, k6 |

- Same zone, so traffic between them is internal and free.
- Firewall: VM 1 accepts 80 and 443 from anywhere; 5432 only from VM 2's internal IP (read-only user for evaluation); 6379 never exposed.
- Budget alert at $20. Stop both VMs when not in use.
- Raise limits on VM 1: `ulimit -n 200000`, `net.core.somaxconn=65535`.

### 4.2 Docker Compose on VM 1

| Service | Image | Notes |
|---|---|---|
| `nginx` | nginx:stable | Ports 80, 443. Serves `/web/dist`, proxies `/api` |
| `api1`, `api2` | built from `/server` | `node src/index.js` |
| `worker` | built from `/server` | `node src/worker.js`, one instance |
| `scoring` | built from `/scoring` | `uvicorn app:app --port 8000`, internal only |
| `postgres` | postgres:16 | Volume `pgdata`, `max_connections=200` |
| `redis` | redis:7 | `appendonly no` (Redis data is disposable) |

### 4.3 nginx essentials
- `upstream api { least_conn; server api1:3000; server api2:3000; }`
- `proxy_set_header X-Forwarded-For $remote_addr;` (overwrite, so clients cannot spoof it)
- For `/api/v1/drops/*/events`: `proxy_buffering off; proxy_read_timeout 1h; proxy_http_version 1.1; proxy_set_header Connection "";`
- `worker_connections 65535;`, `worker_rlimit_nofile 200000;`
- Static files with long cache headers for hashed assets; `index.html` not cached.

### 4.4 HTTPS
1. Hostname: the VM's external IP with dashes plus `.sslip.io` (for example `34-93-10-20.sslip.io`).
2. Use a static external IP so the hostname does not change.
3. `certbot --nginx -d <hostname>`.
4. If issuance fails, run the demo on HTTP with `COOKIE_SECURE=false`, and say so in the README.

### 4.5 Deploy steps
1. Install Docker on both VMs.
2. Copy the repo to VM 1 (git clone over HTTPS with a read-only deploy token, or `scp`).
3. Create `.env`, build `/web` (`npm run build`), then `docker compose -f deploy/docker-compose.yml up -d --build`.
4. Run certbot, reload nginx.
5. Check `GET /api/v1/health`, then run the smoke test from VM 2.

## 5. Database schema

`migrations/001_init.sql`

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL,
  normalised_email text NOT NULL UNIQUE,
  role             text NOT NULL DEFAULT 'participant' CHECK (role IN ('participant', 'organiser')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE drops (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  seats               int  NOT NULL CHECK (seats > 0),
  state               text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'CLOSED', 'DRAWN', 'COMPLETE')),
  window_opens_at     timestamptz NOT NULL,
  window_closes_at    timestamptz NOT NULL,
  draw_at             timestamptz NOT NULL,
  confirm_window_min  int  NOT NULL CHECK (confirm_window_min > 0),
  ticket_price        int  NOT NULL,
  seed_commit         text NOT NULL,
  manifest_hash       text,
  seed_revealed       text,
  scoring_started_at  timestamptz,
  scored_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE drop_secrets (
  drop_id text PRIMARY KEY REFERENCES drops(id),
  seed    text NOT NULL
);

CREATE TABLE entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id        text NOT NULL REFERENCES drops(id),
  user_id        uuid NOT NULL REFERENCES users(id),
  device_fp      text,
  ip             inet,
  subnet         text,
  pow_server_ms  int,
  created_at     timestamptz NOT NULL DEFAULT now(),
  state          text NOT NULL DEFAULT 'ENTERED'
                 CHECK (state IN ('ENTERED', 'WON', 'WAITLISTED', 'CONFIRMED', 'EXPIRED', 'NOT_SELECTED')),
  risk           smallint,
  weight         numeric(4,2) NOT NULL DEFAULT 1.00 CHECK (weight > 0 AND weight <= 1),
  rank           int,
  UNIQUE (drop_id, user_id)
);
CREATE INDEX entries_drop_state_rank ON entries (drop_id, state, rank);
CREATE INDEX entries_drop_fp ON entries (drop_id, device_fp);
CREATE INDEX entries_drop_subnet ON entries (drop_id, subnet);

CREATE TABLE seat_slots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id      text NOT NULL REFERENCES drops(id),
  slot_no      int  NOT NULL,
  entry_id     uuid NOT NULL REFERENCES entries(id),
  state        text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'CONFIRMED', 'UNFILLED')),
  confirm_by   timestamptz NOT NULL,
  anchor_hash  text,
  payer_name   text,
  confirmed_at timestamptz,
  UNIQUE (drop_id, slot_no),
  UNIQUE (drop_id, entry_id),
  UNIQUE (drop_id, anchor_hash)
);
CREATE INDEX seat_slots_expiry ON seat_slots (state, confirm_by);

CREATE TABLE tickets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id        uuid NOT NULL UNIQUE REFERENCES seat_slots(id),
  holder_user_id uuid NOT NULL REFERENCES users(id),
  payer_name     text NOT NULL,
  issued_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE risk_signals (
  entry_id     uuid PRIMARY KEY REFERENCES entries(id),
  device       real NOT NULL,
  ip           real NOT NULL,
  timing       real NOT NULL,
  email        real NOT NULL,
  cluster_id   text,
  cluster_size int,
  reasons      jsonb NOT NULL DEFAULT '[]',
  linked       jsonb NOT NULL DEFAULT '[]',
  scored_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  seq       bigint PRIMARY KEY,
  drop_id   text,
  type      text NOT NULL,
  payload   text NOT NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  prev_hash char(64) NOT NULL,
  hash      char(64) NOT NULL
);
CREATE SEQUENCE audit_seq;

CREATE TABLE sim_runs (
  run_id      text PRIMARY KEY,
  scenario    text NOT NULL,
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
```

Notes:
- `drops.seed_revealed` is null until the draw; the live seed sits in `drop_secrets` until then.
- Postgres allows many NULLs in `UNIQUE (drop_id, anchor_hash)`, so pending slots are fine.
- `pg` returns `numeric` as a string: always `Number(weight)` before building the manifest.
- Read-only user for VM 2: `CREATE ROLE fairdrop_ro LOGIN PASSWORD '...'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO fairdrop_ro;`
- Migrations: on API start, take advisory lock 1, apply any file in `/migrations` not listed in `schema_migrations`, in name order.

## 6. Redis keys

| Key | Value | TTL |
|---|---|---|
| `sess:<sid>` | session (userId, role) | 7 days |
| `otp:<normalisedEmail>` | `{ codeHash, attempts }` | 10 min |
| `pow:<challengeId>` | `{ prefix, difficulty, issuedAt, ip }` | 2 min, deleted on use |
| `rl:<name>:<key>` | rate limiter buckets | managed by the library |
| `idem:<sid or ip>:<route>:<key>` | `{ state, status, body, bodyHash }` | 24 h (in-progress lock 30 s) |
| `cache:drop:<id>` | drop details JSON | 5 s |
| `cache:draw:<id>`, `cache:manifest:<id>`, `cache:results:<id>` | JSON after the draw | no expiry |
| `cache:status:<dropId>:<userId>` | status JSON | 2 s, deleted on change |
| channel `drop:<id>` | `drop_state` events | pub/sub |
| channel `user:<userId>` | `your_status` events | pub/sub |

## 7. Backend structure

### 7.1 Middleware order
1. `pino-http` request logging with a request ID
2. `helmet`, `express.json({ limit: "16kb" })`
3. `clientIp`: reads `X-Forwarded-For` (set by nginx), stores `req.clientIp` and `req.subnet` (/24 for IPv4, /64 for IPv6)
4. `testAccess`: if `X-Test-Key` equals `TEST_KEY` (constant-time compare), sets `req.isTest = true` and, if `X-Test-Client-IP` is present, overrides `req.clientIp` and `req.subnet`
5. `session` (Redis store, cookie `sid`, HttpOnly, SameSite=Lax, Secure from env)
6. Route-level: `rateLimit(group)`, `requireAuth`, `requireOrganiser`, `idempotency`, `validate(zodSchema)`
7. Error handler: maps `AppError(code, status)` to the error format; unknown errors become 500 with the request ID logged; pool timeouts become `503 SERVICE_BUSY` with `Retry-After: 2`

CSRF: same origin plus SameSite=Lax plus requiring `Content-Type: application/json` on all mutating routes is enough here.

### 7.2 Transaction helper
`withTx(async (client) => { ... })` runs `BEGIN`, the callback, then `COMMIT`, with `ROLLBACK` on error. Use it for every multi-statement write.

### 7.3 Startup
1. Run migrations.
2. Load `drops.yaml`: for each drop, `INSERT ... ON CONFLICT (id) DO NOTHING`, generating `seed` and `seed_commit` only for new drops (seed goes into `drop_secrets` in the same transaction). Existing drops are never updated.
3. Load organiser emails into memory.

## 8. Core flows (implementation)

### 8.1 Login
1. `GET /pow/challenge`: difficulty = `TEST_POW_DIFFICULTY` if `req.isTest`, otherwise `POW_DIFFICULTY` plus 0 to 4 bits depending on the IP's recent request count. Store in Redis.
2. `POST /auth/otp/request`: validate email, reject disposable domains, verify and delete the puzzle, rate-limit by IP and email. Generate a 6 digit code with `crypto.randomInt`, store `sha256(code)` with attempts 0. If `req.isTest` return `{ devCode }`. Send email unless the domain is `fairdrop.test`.
3. `POST /auth/otp/verify`: compare hashes; on failure increment attempts and return `OTP_INVALID`, and at 5 delete the key and return `OTP_LOCKED`. On success upsert the user by `normalised_email` (role organiser if in config), `req.session.regenerate`, store userId and role.

Email normalisation: lowercase, trim, remove `+tag` from the local part; for `gmail.com` and `googlemail.com` also remove dots and use `gmail.com`.

### 8.2 Entry
1. Verify the puzzle: challenge exists, unused, same IP, SHA-256 of `prefix + nonce` has enough leading zero bits. Record `pow_server_ms = now - issuedAt`. Delete the challenge.
2. In one transaction:
   ```sql
   SELECT state, window_opens_at, window_closes_at FROM drops WHERE id = $1 FOR SHARE;
   -- reject unless state = 'OPEN' AND now() BETWEEN window_opens_at AND window_closes_at
   INSERT INTO entries (drop_id, user_id, device_fp, ip, subnet, pow_server_ms)
   VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, state;
   ```
3. Unique violation on `(drop_id, user_id)`: `ALREADY_ENTERED`.

`FOR SHARE` lets many entries run at once while blocking the close step's `FOR UPDATE`, so no entry commits after close.

### 8.3 Close
```sql
SELECT id FROM drops WHERE id = $1 FOR UPDATE;
UPDATE drops SET state = 'CLOSED' WHERE id = $1 AND state = 'OPEN';
```
No row changed: `INVALID_STATE`. Write audit row, publish `drop_state`.

### 8.4 Scoring
1. `UPDATE drops SET scoring_started_at = now() WHERE id = $1 AND state = 'CLOSED' AND scoring_started_at IS NULL`. No row: `INVALID_STATE`.
2. `POST {SCORING_URL}/score { dropId }` with a 120 second timeout.
3. On success: `UPDATE drops SET scored_at = now()`, audit row with counts. On failure: reset `scoring_started_at` to null so it can be retried, return 502.

### 8.5 Draw
One transaction:
1. `UPDATE drops SET state = 'DRAWN' WHERE id = $1 AND state = 'CLOSED' AND (scoring_started_at IS NULL OR scored_at IS NOT NULL) RETURNING seats, confirm_window_min`. No row: `INVALID_STATE`.
2. Read the seed from `drop_secrets`, and `SELECT id, weight FROM entries WHERE drop_id = $1 AND state = 'ENTERED' ORDER BY id`.
3. Build the manifest and its hash; compute keys and ranks exactly as PRD 9.1. Sort entry IDs as strings (the same order Postgres uses for `ORDER BY id::text`; sort in JS to be safe).
4. Write ranks and states in one statement:
   ```sql
   UPDATE entries e SET rank = r.rank,
          state = CASE WHEN r.rank <= $2 THEN 'WON' ELSE 'WAITLISTED' END
   FROM unnest($3::uuid[], $4::int[]) AS r(id, rank)
   WHERE e.id = r.id;
   ```
5. Insert winners into `seat_slots` (`slot_no` = rank) with `confirm_by = now() + confirm_window_min * interval '1 minute'`, in one `INSERT ... SELECT`.
6. `UPDATE drops SET manifest_hash = $1, seed_revealed = $2`.
7. Audit row. After commit: cache draw, manifest and results; publish `drop_state` and per-user `your_status` (batched); queue win emails.

50,000 entries take well under a second for hashing and sorting in Node.

### 8.6 Confirm
1. Fingerprint = `sha256(testCard.trim().toLowerCase())`; `anchorHash = HMAC-SHA256(ANCHOR_PEPPER, fingerprint)`.
2. One transaction:
   ```sql
   UPDATE seat_slots s
   SET state = 'CONFIRMED', anchor_hash = $1, payer_name = $2, confirmed_at = now()
   FROM entries e
   WHERE s.entry_id = e.id AND e.user_id = $3 AND s.drop_id = $4
     AND s.state = 'PENDING' AND s.confirm_by > now()
   RETURNING s.id, s.slot_no, e.id AS entry_id;
   ```
   Then mark the entry `CONFIRMED`, insert the ticket, write audit.
3. Unique violation on `anchor_hash`: `ANCHOR_ALREADY_USED`.
4. No row: look up the user's entry and slot and return `ALREADY_CONFIRMED`, `CONFIRM_WINDOW_EXPIRED` or `NOT_A_WINNER`.
5. After commit: clear status cache, publish `your_status`.

### 8.7 Worker loop (every `WORKER_INTERVAL_MS`)
Wrapped in `pg_try_advisory_lock(2)`; skip the tick if not acquired.

For each slot from `SELECT ... FROM seat_slots WHERE state = 'PENDING' AND confirm_by <= now() LIMIT 200`, in its own transaction:
1. `UPDATE entries SET state = 'EXPIRED' WHERE id = <current entry> AND state = 'WON'`.
2. Next entry: `SELECT id FROM entries WHERE drop_id = $1 AND state = 'WAITLISTED' ORDER BY rank LIMIT 1 FOR UPDATE SKIP LOCKED`.
3. If found: `UPDATE seat_slots SET entry_id = <next>, confirm_by = now() + window WHERE id = $1 AND state = 'PENDING' AND confirm_by <= now()`, then `UPDATE entries SET state = 'WON'` for the next entry. Audit `PROMOTED`, queue email, publish.
4. If not found: `UPDATE seat_slots SET state = 'UNFILLED'`. Audit.

Then for each `DRAWN` drop with no `PENDING` slots: mark remaining `WAITLISTED` entries `NOT_SELECTED`, set the drop `COMPLETE`, audit, publish.

Emails are sent from an in-memory queue in the worker with small concurrency (2) and retries (3). Email failures never block state changes.

### 8.8 Status and waitlist position
```sql
SELECT e.id, e.state, e.rank, s.confirm_by,
       CASE WHEN e.state = 'WAITLISTED' THEN
         (SELECT COUNT(*) FROM entries w WHERE w.drop_id = e.drop_id
            AND w.state = 'WAITLISTED' AND w.rank < e.rank) + 1 END AS waitlist_position
FROM entries e LEFT JOIN seat_slots s ON s.entry_id = e.id
WHERE e.drop_id = $1 AND e.user_id = $2;
```
Cached for 2 seconds per user and cleared on any change to that user.

### 8.9 SSE
- `GET /drops/:dropId/events` (logged in): set `Content-Type: text/event-stream`, `Cache-Control: no-cache`, flush headers.
- First message: the user's current status (`your_status`) and drop state.
- Each API process keeps one Redis subscriber and a map of open connections by userId and dropId; messages on `user:<id>` and `drop:<id>` go to matching connections.
- Heartbeat comment every 20 seconds. Remove the connection on `close`.

### 8.10 Audit append
```sql
SELECT pg_advisory_xact_lock(3);
SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1;   -- or 64 zeros
SELECT nextval('audit_seq');
INSERT INTO audit_log (seq, drop_id, type, payload, prev_hash, hash) VALUES (...);
```
`payload` is `JSON.stringify(object)`; `hash` as PRD 9.7. Called inside the same transaction as the action it records. Entries are not audited one by one (they are covered by the manifest), which keeps the lock off the busy path.

### 8.11 Idempotency
For `POST` entries, confirm, close, score and draw:
1. Key `idem:<sid or ip>:<route>:<Idempotency-Key>`. `SET NX` with `{ state: "running", bodyHash }` for 30 s.
2. If it exists and is still running: return `SERVICE_BUSY` with `Retry-After: 1`.
3. If it exists with a stored response: return it if `bodyHash` matches, else `IDEMPOTENCY_MISMATCH`.
4. After the handler: store status and body for 24 h. Missing header: proceed without idempotency (the database constraints still protect correctness).

### 8.12 Admin results endpoints
- `POST /admin/runs`: organiser only, validates the results file shape (PRD 11.3), `INSERT ... ON CONFLICT (run_id) DO UPDATE`.
- `GET /admin/runs`, `GET /admin/runs/:runId`: read from `sim_runs`.

## 9. Scoring service

- FastAPI app in `/scoring`, internal only (no nginx route).
- `POST /score { "dropId": "..." }` returns `{ "scored": n, "flagged": m, "durationMs": t }`.
- Reads entries with their users' normalised emails for the drop; computes features (PRD 9.2); predicts with the trained model from `/scoring/model/model.joblib`, or the fallback rule if the file is missing.
- Applies tiers and the two-signal guard, then writes in one transaction: `UPDATE entries SET risk, weight` (bulk via `unnest`) and `INSERT INTO risk_signals ... ON CONFLICT (entry_id) DO UPDATE`.
- Refuses if the drop is not `CLOSED`.
- Target: 50,000 entries under 60 seconds.
- `GET /health` for compose health checks.

## 10. Frontend technical notes

- Vite dev server proxies `/api` to `http://localhost:3000` so the cookie works in development.
- All fetches use `credentials: "same-origin"` and send `Content-Type: application/json` and an `Idempotency-Key` on mutating calls.
- Puzzle solving and the verify page's ranking run in Web Workers using `js-sha256`.
- Device fingerprint: SHA-256 of userAgent, language, timezone, screen width x height x colour depth, hardwareConcurrency, platform.
- SSE via `EventSource`; on error, poll `/entries/me` every 5 seconds until it reconnects.
- Buttons that mutate are disabled while their request runs.
- Production build output served by nginx; client routes fall back to `index.html`.

## 11. Simulator and load test

- Run from VM 2 against VM 1's internal IP over HTTP port 80 (nginx), with `X-Test-Key`.
- Each simulated user gets a test client IP; bot clusters share subnets as their scenario requires.
- Labels stay in the simulator's own output; never sent to the server.
- Evaluation reads the database with the read-only user, computes the metrics in PRD 11.2, and uploads the results file to `POST /admin/runs` with an organiser session.
- k6 scripts: `window_open.js` (challenge, login, enter) and `results_reveal.js` (status reads and SSE connections). Thresholds encode the PRD latency targets.

## 12. Security checklist

- [ ] Secrets only in `.env` on the VM; `.env.example` committed with placeholders
- [ ] `TEST_KEY` compared in constant time; test features unreachable without it
- [ ] Cookie HttpOnly, SameSite=Lax, Secure on HTTPS; session regenerated at login
- [ ] All inputs validated with zod; body size limit 16 kb
- [ ] Parameterised SQL only
- [ ] Payment tokens never stored; card hashed with a pepper
- [ ] Seed kept in `drop_secrets` until the draw
- [ ] Postgres and Redis never exposed publicly
- [ ] `X-Forwarded-For` overwritten by nginx
- [ ] Organiser routes check role on every request

## 13. Observability

- `GET /api/v1/health`: checks Postgres and Redis, returns `{ ok, db, redis }`.
- pino JSON logs with request ID, route, status and duration; `docker compose logs -f api1`.
- Counters in Redis per minute (`stats:<dropId>:entries:<minute>`, `stats:<dropId>:ratelimited:<minute>`) feed the dashboard's live endpoint.

## 14. Performance tuning

- `DB_POOL_MAX=20` per API process, 10 for the worker; Postgres `max_connections=200`.
- Pool acquire timeout 2 s, then `SERVICE_BUSY`.
- Cache drop details (5 s), draw data (forever after draw), per-user status (2 s).
- Node: one process per container, 2 API containers on 4 vCPUs (leave room for Postgres).
- nginx keepalive to upstream (`keepalive 64`).

## 15. Testing

| Test | Where | When |
|---|---|---|
| `scripts/mvp-smoke-test.mjs` | VM 2 or laptop, with `TEST_KEY` | After every backend milestone |
| Manual checklist | Browser | Before H4:15 |
| Simulator scenarios S0 to S6 | VM 2 | H3:30 to H4:15 |
| k6 bursts | VM 2 | H3:30 to H4:15 |

## 16. Timeline

See PRD Section 13. Feature freeze at H4:15.
