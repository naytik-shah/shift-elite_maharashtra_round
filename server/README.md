# Fair Drop backend

Node 20+, Express, Postgres, Redis. One codebase, two entry points: the API (`src/index.js`) and the worker (`src/worker.js`).
The product rules are in `docs/PRD.md`, the build plan in `docs/MVP.md` and `docs/TRD.md`.

## Run it on your machine

You need Node 20+ and Docker.

```bash
docker compose -f deploy/docker-compose.dev.yml up -d    # Postgres on 5433, Redis on 6380
cd server
cp .env.example .env                                      # then fill in SESSION_SECRET, ANCHOR_PEPPER, TEST_KEY
npm install
node --env-file=.env src/index.js                         # API on :3000
node --env-file=.env src/worker.js                        # worker (second terminal)
```

Tables are created on first start and the drops in `config/drops.yaml` are loaded (new drops only, existing
drops are never changed). `TEST_KEY` can be any 16+ character string; leave it empty to switch test access off.

## Run the full stack (nginx, two APIs, worker, Postgres, Redis)

```bash
cp deploy/.env.example deploy/.env      # fill in the secrets
deploy/up.sh                            # builds, starts, reloads nginx, waits until healthy
```

`deploy/up.sh` reloads nginx afterwards (no dropped connections): nginx looks up the API addresses only when it starts
or reloads, so it must reload whenever the API containers are recreated. If one API container is down, nginx sends
reads to the other one. Only nginx is published (`HTTP_PORT`).

## Tests

All scripts live in `scripts/` (`cd scripts && npm install`). Set `TEST_KEY` to the server's key, and
`BASE_URL`, `DATABASE_URL`, `REDIS_URL` if they differ from the local defaults.

| Script | What it checks | Time |
|---|---|---|
| `mvp-smoke-test.mjs` | The whole MVP flow with 100 users (MVP.md section 9.2). Reset first: `DROP_ID=smoke-test node reset-drop.mjs` | 2 min |
| `edge-tests.mjs` | 48 abuse and edge cases: bad input, puzzle misuse, code guessing, rate limits, idempotency, entry versus close race, confirm races, empty draw, live updates, audit chain | 15 s |
| `expiry-test.mjs` | Seats expiring, waitlist promotion, confirms landing on the deadline while two workers tick | 2 min |
| `load-test.mjs` | Flash crowd: N users sign in and enter, close, draw, status burst, live push, confirms, then database checks. `USERS=50000 node load-test.mjs` | minutes |
| `resilience-test.mjs` | Redis and Postgres stopped mid-run: the API answers 503, never crashes, and recovers | 1 min |

`edge-tests`, `expiry-test` and `load-test` use the extra drops in `config/drops.test.yaml`; load them with
`DROPS_CONFIG_PATH=../config/drops.yaml,../config/drops.test.yaml`. Do not load them on the public server.
`scripts/run-in-docker.sh <script>` runs any script inside the Docker network of the full stack.

## Behaviour the frontend should know

* Errors are always `{ "error": { "code", "message" } }`. 429 and 503 carry a `Retry-After` header.
* `GET /drops/:id/entries/me` is 404 until the person has entered.
* The live stream (`GET /drops/:id/events`) sends, in order: `your_status` (only if the person has entered), then `drop_state`.
  After that: `drop_state`, `your_status`, `waitlist_moved` (`{ waitlistPosition }`), `manifest_published`, `draw_complete` (`{ seed }`)
  and a `heartbeat` every 20 seconds. Every message is one JSON object, so the client can do `{ type: eventName, ...data }`.
  A reconnect always starts with the true current status. A person can have at most 5 streams open per API process.
* `your_status` data: `{ entryId, state, rank, waitlistPosition, confirmBy }`.
* Confirm takes `{ testCard, payerName }` and returns `{ ticket: { id, dropId, slotNo, seatNo, holderName } }` (`seatNo` is the same number as `slotNo`).
* A puzzle challenge is `{ challengeId, prefix, difficulty, expiresAt }`. Find a decimal `nonce` so that SHA-256 of `prefix + nonce` has
  `difficulty` leading zero bits. A puzzle works once, only from the address that asked for it, and only for the purpose it was issued for.
* Writes need `Content-Type: application/json` (even with an empty body), otherwise 400.
* `Idempotency-Key` on writes: repeating the same key with the same body returns the first answer (header `Idempotent-Replay: true`).
* Sessions: HttpOnly, SameSite=Lax cookie named `sid`, 7 days, new id at every login.

## What is where

```
src/app.js            middleware order (see the comments there)
src/middleware/       clientIp, testAccess, session, rateLimit, idempotency, auth, errors
src/routes/           auth, drops (+ draw data + live stream), entries (+ confirm), admin
src/services/         draw, confirm, waitlist (the worker tick), events (live updates), status, audit, pow, mailer, ...
migrations/           plain SQL, applied at startup under an advisory lock
```

Correctness rules that live in Postgres, not in application code: unique `(drop, user)` entries, exactly N seat slots created once in the
draw transaction, one conditional `UPDATE` to confirm a seat, a unique index on the keyed card hash, and conditional updates that make
close and draw run once. Losing Redis can log people out or slow things down but can never oversell or duplicate a seat.
