# Fair Drop: Product Requirements Document

**Problem statement:** Bit N Build, Web/App Dev PS 3: "Fair Drop: Selling 500 Seats to 50,000 People Without Letting Bots Win"
**Team:** Naytik Shah (Backend), Jash Madhani (Frontend), Zeal Shah (Bot defence and adversarial testing)
**Version:** v2.0, 4 Oct 2026
**Status:** Active. Companion documents: `docs/TRD.md` (how it is built) and `docs/MVP.md` (what ships first).

---

## 1. Problem

High-demand drops (tickets, registrations, limited seats) are usually first-come-first-served. That turns the sale into a race, and races are won by whoever has the fastest connection or the most automated clients. Bots send thousands of requests at the opening second, servers buckle, and real people get timeouts and inconsistent results.

As long as arrival time decides who wins, bots keep an edge. Our approach removes speed from the equation entirely.

## 2. Core idea

Fair Drop replaces the race with a **registration window followed by a weighted, verifiable lottery**.

1. **Speed does not matter.** Anyone who enters during the window has the same base chance, whether they entered in the first second or the last hour.
2. **The only way to cheat a lottery is to hold more tickets.** So the defence focuses on finding fake-identity clusters before the draw and on making each win hard to cash in for anyone who is not a distinct real person.
3. **Free to enter, pay only if you win.** Nobody pays or has money held to enter. Winners pay at confirmation, and each payment method can confirm only one seat per drop.
4. **Suspicious entries are down-weighted, not banned.** A real user who gets wrongly flagged keeps some chance, while a bot farm gets diluted to almost nothing.
5. **The draw can be checked.** The seed hash is published before entries open and the seed is revealed after the draw, so anyone can re-run it.
6. **Tickets are named and non-transferable.** The ticket carries the payer's name, which removes most of the resale incentive behind bot farms.

We do not claim to stop every bot. The PS asks that bots gain no significant advantage, and we measure exactly how much advantage they get.

## 3. Goals and non-goals

### Goals
- Bots gain no meaningful advantage through speed, request volume or repeated attempts.
- Zero overselling, zero duplicate entries and zero duplicate seat assignments, under any load.
- The system stays up during a simulated flash crowd of 50,000 users.
- User state survives refreshes, reconnects and temporary failures.
- Fairness is measurable: configurable attack scenarios produce clear numbers.

### Non-goals
- Real money movement (payments use an in-app mock)
- Real SMS (email codes in the demo, phone codes in production)
- Government ID or KYC checks
- Seat maps or choosing specific seats
- Resale or transfer marketplace
- Native mobile apps, multi-region deployment
- Group entry (stretch goal)

## 4. Users

| User | What they need |
|---|---|
| **Participant** | Enter easily, always know their status, trust the result |
| **Organiser** | Configure a drop, watch it live, run scoring and the draw, review flagged entries with evidence, see fairness numbers |
| **Verifier** (anyone, including judges) | Confirm independently that the draw was not rigged |
| **Attacker** (simulated) | Win as many seats as possible with automation, many accounts and retries |

## 5. Lifecycle and states

```
OPEN  ->  CLOSED  ->  (scoring)  ->  DRAWN  ->  COMPLETE
```

| Drop state | What happens |
|---|---|
| OPEN | Created from config. Seed hash and draw time are published. Entries accepted inside the window. Config can no longer change. |
| CLOSED | No new entries. Closing takes a lock on the drop, so no entry can commit after it. The organiser runs scoring once; it writes a risk score and weight for every entry. |
| DRAWN | The organiser runs the draw: manifest built from current weights, every entry ranked, exactly N seat slots created (N = seats), seed revealed. |
| COMPLETE | No pending seat slots remain. Remaining waitlisted entries become `NOT_SELECTED`. |

**Entry states:** `ENTERED`, `WON`, `WAITLISTED`, `CONFIRMED`, `EXPIRED`, `NOT_SELECTED`
**Seat slot states:** `PENDING`, `CONFIRMED`, `UNFILLED` (waitlist ran out)

Winners have 10 minutes to confirm. An unconfirmed seat moves to the next waitlisted entry, who gets a fresh 10 minutes.

## 6. User flows

### 6.1 Participant
1. Opens the drop page: seats, window times, draw time, published seed hash.
2. Requests a login code by email. The browser solves a small puzzle (proof-of-work) first.
3. Enters the code and gets a session (new session ID at every login).
4. Clicks Enter. The browser solves another puzzle and sends a device fingerprint. Entry is free, one per person.
5. The status page updates live. Refreshing or reconnecting always shows the correct status.
6. After the draw (live update plus email): **Won (confirm by time X)**, **Waitlisted (#k)** or later **Not selected**.
7. A winner confirms by paying with a test card. The card must not have confirmed another seat in this drop. The ticket is issued in the payer's name.
8. If a waitlisted user is promoted, they get an email and a live update and have 10 minutes to confirm.

### 6.2 Organiser
1. Defines drops in `config/drops.yaml` (seats, window, draw time, confirm window, ticket price).
2. Watches the live dashboard: entries, seat slots, waitlist, request rates.
3. Closes entries, runs scoring, reviews flagged entries with evidence.
4. Runs the draw.
5. Watches confirmations and promotions, then reviews fairness results from test runs.

### 6.3 Verifier
1. Checks that the revealed seed hashes to the published seed hash.
2. Checks the manifest against its published hash.
3. Re-runs the draw on the verify page in the browser and compares the ranking.

## 7. Functional requirements

Mapped one-to-one to the key features in the problem statement.

### 7.1 High-Concurrency Support
- **FR-1.1** Entries are spread across a window, so there is no single-second spike for entry submission.
- **FR-1.2** The API is stateless and runs as multiple replicas behind nginx.
- **FR-1.3** Postgres connections are pooled. When the pool is exhausted the API returns `503 SERVICE_BUSY` with `Retry-After` instead of hanging.
- **FR-1.4** Draw results and manifests are cached after the draw; the reveal burst only does cache reads and indexed lookups.
- **FR-1.5** Live updates use SSE with Redis pub/sub for fan-out across replicas. nginx and the OS are tuned for many open connections; a 20 second heartbeat keeps them alive.

### 7.2 Abuse Handling
- **FR-2.1 Identity anchor at confirmation:** each payment method can confirm at most one seat per drop (unique constraint on a keyed hash of the card). A bot account that wins still needs a distinct real payment method to keep its seat.
- **FR-2.2 Login:** email codes. One account per normalised email (lowercase, plus tags removed, dots removed for Gmail). Disposable domains rejected. 5 wrong attempts invalidate a code.
- **FR-2.3 Proof-of-work:** code requests and entries need a solved puzzle. Difficulty rises for busy IPs and subnets, with a cap.
- **FR-2.4 Rate limiting:** per IP, subnet, session and email (Section 9.4). Client IP is taken from our own nginx only.
- **FR-2.5 Idempotency:** mutating requests carry an `Idempotency-Key`, scoped to session and endpoint, with a body hash check and an in-progress lock.
- **FR-2.6 Risk scoring:** after close, a scoring model rates every entry on four signal families (Section 9.2) and writes a risk score, a weight and evidence.
- **FR-2.7 Down-weighting:** weights come from risk tiers. No entry is removed for its risk score, and an entry is only down-weighted when at least two signal families agree.

### 7.3 Allocation Integrity
- **FR-3.1** Unique constraints: `(drop_id, user_id)` on entries; `(drop_id, slot_no)`, `(drop_id, entry_id)`, `(drop_id, anchor_hash)` on seat slots; `normalised_email` on users.
- **FR-3.2 Fixed seat slots:** exactly N slots are created in the draw transaction and never inserted again, so overselling is structurally impossible.
- **FR-3.3 Single-statement confirm:** confirm, expiry and promotion are conditional updates on the database clock. If two actions race, one changes the row and the other changes nothing.
- **FR-3.4 Guarded state changes:** close, scoring and draw each run at most once (conditional updates on drop state). Draw is blocked while scoring is in progress.
- **FR-3.5 Window cutoff:** entry inserts check the window and drop state inside the transaction; close takes a row lock, so nothing slips in during close.
- **FR-3.6 Immutable drops:** once created, seats, window, draw time and seed never change, even if the config file changes.
- **FR-3.7 Correctness lives in Postgres:** losing Redis can slow the system or log users out, but can never oversell or duplicate. Rate limiting fails closed for entries and open for reads.
- **FR-3.8 Audit log:** close, scoring, draw, confirm, expiry, promotion and completion write an append-only, hash-chained audit row.

### 7.4 Reliable Sessions
- **FR-4.1** Sessions in Redis behind an HTTP-only, SameSite=Lax cookie (Secure on HTTPS). New session ID at login.
- **FR-4.2** Postgres is the source of truth for entry and seat state.
- **FR-4.3** On every SSE connect or reconnect the server first sends the user's current status, so a missed event never leaves the client wrong.
- **FR-4.4** If SSE fails, the client falls back to polling `/entries/me`.
- **FR-4.5** 10 minute confirm window. Draw time is announced in advance, and every win or promotion sends an email alongside the live update.
- **FR-4.6** UI and API share one domain so the cookie works everywhere.

### 7.5 Adversarial Testing
- **FR-5.1** A Node bot simulator runs configurable honest and attacker populations against the real API from a separate machine.
- **FR-5.2** k6 runs flash-crowd load (window open, results reveal).
- **FR-5.3** Defences (puzzle, rate limits, scoring) can be toggled per run.
- **FR-5.4** Test access: requests carrying the secret `X-Test-Key` may set a test client IP, receive login codes in the response and get a lower puzzle difficulty. Without the key, the server behaves normally. This lets the live server and the tests share one deployment safely.

### 7.6 Fairness Measurement
- **FR-6.1** Each simulator run uploads a results file; the dashboard charts it.
- **FR-6.2** Metrics and targets are defined in Section 11.

## 8. Architecture

```
            Browser (React + Vite: pages, puzzle worker, fingerprint, SSE, verify)
                                   |
                                   v  HTTPS, one domain
                        +---------------------+
                        |        nginx        |  static web app, /api proxy,
                        +----------+----------+  load balancing, SSE tuning
                           |               |
                    +------v-----+   +-----v------+
                    |   API #1   |   |   API #2   |   Node + Express
                    +------+-----+   +-----+------+
                           |   \       /   |
                           |    \     /    |        +------------------+
                           |     \   /     +------->| Scoring service  |
                           |      \ /               | Python, model    |
               +-----------v+      X       +--------+-------+----------+
               | PostgreSQL |<----/ \----->|     Redis      |
               | (truth)    |              | sessions, rate |
               +-----^------+              | limits, PoW,   |
                     |                     | pub/sub, cache |
               +-----+------+              +----------------+
               |   Worker   |  expiry, promotion, completion, emails
               +------------+

VM 1 (Google Cloud): everything above, in Docker Compose
VM 2 (Google Cloud): bot simulator + k6, attacks VM 1 over the internal network
```

| Component | Tech | Responsibility |
|---|---|---|
| Web app | React + Vite | Participant pages, verify page, organiser dashboard |
| nginx | nginx | HTTPS, static files, `/api` proxy, load balancing, SSE |
| API | Node.js + Express | Auth, entries, confirm, SSE, admin endpoints |
| Worker | Node.js (same codebase) | Expiry, promotion, completion, email sending |
| Scoring service | Python | Risk model; reads entries, writes risk, weights and evidence |
| Database | PostgreSQL | All correctness-critical state |
| Cache | Redis | Sessions, rate limits, puzzles, idempotency, pub/sub, caches |
| Testing | Node simulator + k6 | Attack scenarios and load |

## 9. Key designs

### 9.1 Weighted, verifiable draw
1. At drop creation: `seed` = 32 random bytes as a 64 character hex string. `seedCommit` = SHA-256 of the seed string (hex). Published immediately.
2. At draw: manifest = all entries as `{ entryId, weight }` (that key order), sorted by entryId. `manifestHash` = SHA-256 of `JSON.stringify(manifest)` (hex).
3. For each entry: `h` = HMAC-SHA256(key = seed string, message = entryId) as hex. `u = (parseInt(h.slice(0, 13), 16) + 1) / (2^52 + 1)`. `key = ln(u) / weight`.
4. Sort by key descending; ties go to the smaller entryId. Ranks 1 to N win; the rest form the waitlist in order.
5. The seed is revealed. Anyone can check the seed, the manifest and the ranking.

This is the Efraimidis-Spirakis method for weighted sampling without replacement. It gives a full ranking from one seed, so the waitlist is as verifiable as the winners.

**Known limitation:** the organiser knows the seed while scoring runs. The stretch goal replaces it with a public external value revealed only after close.

### 9.2 Risk scoring
A model trained on simulator data scores every entry on four signal families:

| Family | Signals |
|---|---|
| Device | Entries sharing a fingerprint; a fingerprint seen across many unrelated networks is treated as a common phone model. Weak signal because the browser reports it. |
| IP / subnet | Entries per /24 subnet vs the median. Lower importance because colleges and offices share networks. |
| Timing | Gaps and bursts within a cluster; puzzle solved faster than normal hardware allows (measured on the server). |
| Email | Normalised patterns, sequential numbers, small edit distances, disposable domains. Known institutional domains exempt from the sequential check. |

Plus a cluster feature: the size of the group of entries linked by two or more shared signals.

The model outputs a probability, mapped to `risk` 0 to 100, then to a weight:

| Risk | Weight | Label |
|---|---|---|
| 0-29 | 1.00 | Clean |
| 30-59 | 0.50 | Low |
| 60-84 | 0.20 | Medium |
| 85-100 | 0.05 | High |

**Two-signal guard:** an entry only drops below 1.00 if at least two families independently look suspicious. One signal alone (for example a shared hostel network) never lowers anyone's weight.

**Fallback:** if no trained model is available, the service uses a fixed rule: `risk = 100 x (0.35 device + 0.25 ip + 0.20 timing + 0.20 email)` plus a cluster bonus, with the same tiers and guard.

Every flagged entry stores evidence: family scores, top reasons in plain words and linked entry IDs.

### 9.3 Proof-of-work
- Challenge `{ challengeId, prefix, difficulty }`; the client finds a decimal `nonce` so SHA-256 of `prefix + nonce` starts with `difficulty` zero bits.
- Solved in a Web Worker. Single-use, expires after 2 minutes.
- Base difficulty is configurable (start at 18 bits). It rises by up to 4 bits for an IP or subnet as its request rate grows.
- The server records `pow_server_ms` (issue to answer) for the timing signal.

### 9.4 Rate limits (defaults)

| Scope | Endpoint group | Limit |
|---|---|---|
| IP | All | 60 per min |
| /24 subnet | All | 600 per min |
| IP | Code request | 5 per 10 min |
| Email | Code request | 3 per 10 min |
| Code | Code verify | 5 attempts |
| IP | Code verify | 20 per 10 min |
| Session | Entry submit | 5 per min |
| Session | Status reads | 120 per min |

Over the limit: `429 RATE_LIMITED` with `Retry-After`.

### 9.5 Mock payment
An in-app module. `testCard` and `payerName` go in; the module returns a stable fingerprint per card and always succeeds. Only `HMAC(ANCHOR_PEPPER, fingerprint)` is stored. No real card or UPI data is used. With a real gateway (stretch goal), confirm gains a `CONFIRMING` step and a reconciler job.

### 9.6 Waitlist
A worker runs every 10 seconds under a Postgres advisory lock. It expires pending slots past `confirm_by`, hands each slot to the next `WAITLISTED` entry with a fresh window (or marks it `UNFILLED`), sends emails and live updates, and completes the drop when no pending slots remain.

### 9.7 Audit log
`hash = SHA-256(prev_hash + "|" + seq + "|" + type + "|" + payload)`, first `prev_hash` is 64 zeros, payload stored as text. Editing any row breaks every hash after it.

## 10. API specification

Base path `/api/v1`. JSON. Cookie session unless marked public. Mutating requests send `Idempotency-Key: <uuid>`.
Error format: `{ "error": { "code": "...", "message": "..." } }`.

**Error codes:** `RATE_LIMITED` (429), `POW_INVALID` (400), `OTP_INVALID` (400), `OTP_LOCKED` (429), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `VALIDATION_FAILED` (400), `DROP_NOT_OPEN` (409), `ALREADY_ENTERED` (409), `INVALID_STATE` (409), `NOT_A_WINNER` (403), `ALREADY_CONFIRMED` (409), `ANCHOR_ALREADY_USED` (409), `CONFIRM_WINDOW_EXPIRED` (410), `IDEMPOTENCY_MISMATCH` (422), `SERVICE_BUSY` (503).

### 10.1 Auth
| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/pow/challenge?purpose=otp\|entry` (public) | | `{ challengeId, prefix, difficulty }` |
| POST | `/auth/otp/request` (public) | `{ email, pow: { challengeId, nonce } }` | 202 (with valid test key: `{ devCode }`) |
| POST | `/auth/otp/verify` (public) | `{ email, code }` | 200 `{ user: { id, email, role } }`, sets cookie |
| POST | `/auth/logout` | | 204 |
| GET | `/me` | | `{ id, email, role }` |

### 10.2 Drops and entries
| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/drops` (public) | | `{ drops: [ { id, name, seats, state, windowOpensAt, windowClosesAt, drawAt } ] }` |
| GET | `/drops/:dropId` (public) | | `{ id, name, seats, state, windowOpensAt, windowClosesAt, drawAt, confirmWindowMinutes, ticketPrice, seedCommit }` |
| POST | `/drops/:dropId/entries` | `{ pow, deviceFingerprint }` | 201 `{ entryId, state }` |
| GET | `/drops/:dropId/entries/me` | | `{ entryId, state, rank, waitlistPosition, confirmBy }` |
| POST | `/drops/:dropId/entries/me/confirm` | `{ testCard, payerName }` | 200 `{ ticket: { id, dropId, slotNo, holderName } }` |
| GET | `/tickets/me` | | `{ tickets: [ ... ] }` |
| GET | `/drops/:dropId/events` | | SSE: `your_status`, `drop_state`, `heartbeat` (20 s) |

### 10.3 Draw verification (public)
| Method | Path | Success |
|---|---|---|
| GET | `/drops/:dropId/draw` | `{ seedCommit, seed, manifestHash, algorithm: "es-weighted-v1" }` (seed and hash null before the draw) |
| GET | `/drops/:dropId/draw/manifest` | `{ entries: [ { entryId, weight } ] }` |
| GET | `/drops/:dropId/draw/results` | `{ ranking: [ entryId, ... ], seats }` |

### 10.4 Organiser
| Method | Path | Success |
|---|---|---|
| POST | `/admin/drops/:dropId/close` | 200 `{ state: "CLOSED" }` |
| POST | `/admin/drops/:dropId/score` | 200 `{ scored, flagged, durationMs }` (only once, only when CLOSED) |
| POST | `/admin/drops/:dropId/draw` | 200 `{ seed, manifestHash }` |
| GET | `/admin/drops/:dropId/live` | `{ state, seats, entries, scored, slotsPending, slotsConfirmed, slotsUnfilled, waitlistLeft, entriesPerMin, rateLimitedPerMin }` |
| GET | `/admin/drops/:dropId/slots` | `{ slots: [ { slotNo, state, entryId, confirmBy } ] }` |
| GET | `/admin/drops/:dropId/flags?minScore=60&page=1` | `{ flags: [ { entryId, risk, weight, clusterId, clusterSize } ], page, total }` |
| GET | `/admin/drops/:dropId/flags/:entryId` | `{ entryId, risk, weight, signals: { device, ip, timing, email }, reasons: [ ... ], linkedEntries: [ ... ] }` |
| GET | `/admin/audit?dropId=&before=` | `{ events: [ { seq, type, payload, at, prevHash, hash } ] }` |
| POST | `/admin/runs` | Upload a simulator results file (Section 11.3). 201 |
| GET | `/admin/runs` | `{ runs: [ { runId, scenario, botSharePercent, createdAt } ] }` |
| GET | `/admin/runs/:runId` | The results file |

Organisers are the emails listed under `organisers` in the config file.

## 11. Evaluation

### 11.1 Scenarios
Default scale 500 seats, 50,000 users (configurable).

| Scenario | Attacker behaviour |
|---|---|
| S0 Baseline | Honest users only |
| S1 Naive farm | Many accounts, one device and subnet, fixed timing, sequential emails, few cards |
| S2 Stealth farm | Rotated IPs, random timing, varied emails and fingerprints, small card pool (held out from model training) |
| S3 Retry spammer | Hammers entry and code requests |
| S4 Flooder | High request volume, skips or fakes the puzzle |
| S5 Payment reuse | Winning bot accounts try to confirm with the same few cards |
| S6 Mixed | All of the above, bots at 10, 30 and 50 percent of entries |

Each scenario also runs with individual defences switched off.

### 11.2 Metrics and targets

**Hard guarantees (every run):**

| Metric | Target |
|---|---|
| Oversold seats | 0 |
| Users holding more than one seat | 0 |
| Confirmed seats per payment method per drop | at most 1 |
| Entries accepted after close | 0 |
| Draw reproducible from published seed and manifest | 100% |
| Reconnecting users shown the correct status | 100% |

**Goals:**

| Metric | Definition | Target |
|---|---|---|
| Bot advantage ratio (S1) | bot share of winners / bot share of entries | at most 0.2 |
| Bot advantage ratio (S2) | same | at most 0.5 |
| Bot seat conversion | seats bots confirm / slots bots win | reported |
| Honest fair-share deviation | honest win rate vs seats / honest entries | within 10% |
| False positives | honest entries in Medium or High | at most 5% |
| Entry latency | p95 at 50k users | under 500 ms |
| Status latency | p95 during the reveal burst | under 200 ms |
| Server errors | 5xx (429 excluded) | under 0.5% |

Results are reported with the hardware used.

### 11.3 Results file
Uploaded to `POST /admin/runs` after each run:

```json
{
  "runId": "s2-30pct-1430",
  "scenario": "S2",
  "botSharePercent": 30,
  "defences": { "pow": true, "rateLimits": true, "scoring": true },
  "config": { "seats": 500, "honestUsers": 35000, "botAccounts": 15000, "botCards": 40 },
  "entries": { "honest": 35000, "bot": 15000 },
  "winners": { "honest": 497, "bot": 3 },
  "confirmed": { "honest": 497, "bot": 2 },
  "botAdvantageRatio": 0.02,
  "botSeatConversion": 0.67,
  "honestFairShareDeviation": 0.04,
  "falsePositiveRate": 0.012,
  "latencyMs": { "entryP95": 210, "statusP95": 85 },
  "errors5xx": 0,
  "rateLimited": 15420,
  "hardGuarantees": { "oversoldSeats": 0, "cardsWithTwoSeats": 0, "usersWithTwoEntries": 0, "drawReproducible": true }
}
```

## 12. Data model (summary, full schema in TRD)

| Table | Purpose |
|---|---|
| `users` | Accounts, unique normalised email, role |
| `drops` | Drop config and state, seed commitment, manifest hash, scoring timestamps |
| `drop_secrets` | The seed, kept apart from regular drop data |
| `entries` | One per user per drop, signals, risk, weight, rank, state |
| `seat_slots` | Exactly N per drawn drop, current holder, confirm deadline, card hash |
| `tickets` | One per confirmed slot |
| `risk_signals` | Family scores, cluster and evidence per scored entry |
| `audit_log` | Hash-chained event log |
| `sim_runs` | Uploaded simulator results |

## 13. Build plan (5 hours)

| Time | Naytik (Backend) | Jash (Frontend) | Zeal (Testing and model) |
|---|---|---|---|
| H0-H2 **MVP** | Docker stack, schema, config loader, login, entries, close, draw, confirm, status | Login, drop page, status page, confirm screen, admin buttons | Simulator skeleton (honest + S1), feature extraction, label format, smoke test run |
| H2-H3:30 | Worker (expiry, promotion, completion), SSE, PoW, rate limits, test key, audit log, email, admin endpoints, scoring call | SSE status, puzzle worker, verify page, dashboard (live, slots, audit), flags panel, results charts | All scenarios, model trained (S2 held out), scoring service, results upload |
| H3:30-H4:15 | Deploy to VM 1, HTTPS, tuning | Production build on VM 1, phone checks | Full runs and k6 from VM 2 |
| H4:15 | **Feature freeze** | | |
| H4:15-H5 | Fixes, README | Polish, demo run-through | Results summary, final numbers |

## 14. Risks and known limitations

| Risk | Mitigation |
|---|---|
| Organiser knows the seed during scoring | Seed hash published at creation; external public seed as stretch goal |
| Shared networks look like bot clusters | Two-signal guard, low IP importance, down-weight not ban |
| Many real cards, virtual cards or several UPI IDs on one account | Each bot win needs a distinct payment method and a named ticket; cluster detection lowers bot wins; measured as bot seat conversion |
| Free entry lets bots submit more entries | Scoring carries more load; unconfirmable bot wins expire and move down the waitlist |
| Published weights teach attackers | Accepted cost of a verifiable draw |
| Account selling | Out of scope; venues check ID at entry |
| Promotions arrive when users are away | Draw time announced, email on every win and promotion |
| VM cannot reach 50k | Scale configurable; hardware reported |
| PoW slow on low-end phones | Web Worker, capped difficulty |
| 5 hour deadline | MVP at H2 covers the full happy path; freeze at H4:15 |

## 15. Stretch goals
- Razorpay test mode, with a `CONFIRMING` step and reconciler
- Public external seed
- Phone codes
- Group entry (up to 5, all-or-nothing, tickets named per member)
- Organiser override of individual flags with a logged reason
- Step-up verification to restore a lowered weight

## 16. Glossary

| Term | Meaning |
|---|---|
| Identity anchor | Something costly to duplicate (a payment method, checked at confirmation) that limits one person to one seat |
| Proof-of-work | A small puzzle the browser solves before a request |
| Commit-reveal | Publishing a hash of a secret first and the secret later |
| Manifest | The list of entry IDs and weights the draw runs on |
| Bot advantage ratio | Bots' share of winners divided by their share of entries |
| SSE | Server-Sent Events, a one-way live connection from server to browser |
