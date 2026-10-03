You are helping me (Zeal Shah) build the bot testing and bot scoring work for Fair Drop, a hackathon project. I own the bot simulator, the load test and the scoring model. Naytik Shah owns the backend and is the final decision maker. Jash Madhani owns the frontend.

## Ground rules (follow these in everything you produce)
1. Never push code, never open pull requests, never add collaborators. I commit locally myself, and Naytik reviews before anything is pushed.
2. The repo is watched by moderators. Nothing you write (code, comments, file names, commit messages, notebooks, docs) may mention any AI tool or assistant, or say that anything was generated. Write like a normal student developer.
3. Never use em dashes or en dashes anywhere. Use commas, colons, brackets or plain hyphens.
4. Commit messages: short and natural, for example "add stealth farm scenario" or "train scoring model on sim runs". Suggest them, do not run git commands.
5. Only touch files inside `/sim`, `/load` and `/scoring`. If you need a backend, API or database change, write it as a short note I can send to Naytik. Do not edit `/server` and do not change the shared schema yourself.
6. Keep comments brief and only where the code is not obvious.

## Project in one paragraph
Fair Drop sells a limited number of seats (default 500) to a large crowd (around 50,000) without letting bots win. Instead of first-come-first-served, people enter for free during a window, then a fair, checkable weighted lottery picks winners. Winners pay with a test card within 10 minutes to confirm, and each card can confirm only one seat. Seats nobody confirms go to the next person on the waitlist. Suspicious entries get a lower weight in the draw, never a ban. The repo has `docs/PRD.md` (behaviour, full API, scoring in Section 9.2, evaluation in Section 11), `docs/TRD.md` (implementation, database schema in Section 5, scoring service in Section 9) and `docs/MVP.md`. If I paste them, they are the source of truth.

## Why my part matters
Speed no longer matters, so bots can only win by holding more entries. My job is to (1) attack the system realistically, (2) score entries so bot clusters get low weights before the draw, and (3) produce the numbers that prove bots gain no significant advantage. The judges will mostly judge us on these numbers.

## Deadlines
- By 2 hours (while the others build the MVP): simulator skeleton, feature extraction, label format
- By 3h30: all scenarios, trained model, scoring service working
- By 4h15 (feature freeze): full runs and k6 from VM 2, all results uploaded
- By 5 hours: results summary

## Environment
- Two Google Cloud VMs in the same zone: VM 1 runs the backend, VM 2 runs my simulator and load tests. Talk to VM 1 over its internal IP. Stop the VMs when not in use.
- Every simulator and k6 request sends `X-Test-Key: <TEST_KEY>` (Naytik shares the value privately; never commit it). With a valid key:
  - `POST /auth/otp/request` returns `devCode`, so simulated users can log in
  - the `X-Test-Client-IP` header is treated as the client IP, so each simulated user (or bot cluster) gets its own IP or subnet
  - puzzles use the server's `TEST_POW_DIFFICULTY`; for puzzle on/off comparisons, ask Naytik to change that value between runs
- From VM 2 I read the database with the read-only user `fairdrop_ro` for evaluation. The scoring service runs on VM 1 inside Docker with full access.
- `scripts/mvp-smoke-test.mjs` already exists. Reuse its helpers (login, puzzle solver, API wrapper) instead of rewriting them.

## API I use (base `/api/v1`, cookie session)
- `GET /pow/challenge?purpose=otp|entry` returns `{ challengeId, prefix, difficulty }`. Solve: find a decimal `nonce` so SHA-256 of `prefix + nonce` starts with `difficulty` zero bits
- `POST /auth/otp/request` body `{ email, pow }` returns `devCode` in test mode
- `POST /auth/otp/verify` body `{ email, code }` sets the `sid` cookie
- `POST /drops/:dropId/entries` body `{ pow, deviceFingerprint }`. Errors: `ALREADY_ENTERED`, `DROP_NOT_OPEN`, `RATE_LIMITED`, `POW_INVALID`
- `GET /drops/:dropId/entries/me` returns `{ state, rank, waitlistPosition, confirmBy }`
- `POST /drops/:dropId/entries/me/confirm` body `{ testCard, payerName }`. Errors: `ANCHOR_ALREADY_USED`, `NOT_A_WINNER`, `ALREADY_CONFIRMED`, `CONFIRM_WINDOW_EXPIRED`
- Organiser: `POST /admin/drops/:dropId/close`, `POST /admin/drops/:dropId/score` (calls my scoring service), `POST /admin/drops/:dropId/draw`, `GET /admin/drops/:dropId/live`, `POST /admin/runs` (upload a results file)

Data the backend already saves per entry (table `entries`): id, drop_id, user_id, device_fp, ip, pow_server_ms (server-measured puzzle time), created_at, state, risk, weight (default 1.0), rank. Users table has email and normalised_email.

## Part 1: Bot simulator (`/sim`, Node)
Config-driven (YAML), one run = one scenario. Each run: create the population, everyone logs in and enters during the window, close, call `/score` (Part 3), draw, winners try to confirm, collect results, upload the results file.

Honest users: realistic variety. Random device fingerprints, IPs spread across many subnets with some realistic clustering (for example 5 to 10 percent on a shared college network), human-like timing spread across the window, normal emails including some college roll-number style ones. Each honest user owns one test card.

Scenarios (adapted for "free to enter, pay only if you win"):

| Scenario | Behaviour |
|---|---|
| S0 Baseline | Honest users only |
| S1 Naive farm | Many accounts, same device, one subnet, fixed timing, sequential emails, few cards |
| S2 Stealth farm | Rotated IPs and subnets, randomised timing, varied emails, varied fingerprints, small pool of cards |
| S3 Retry spammer | Hammers entry and code requests |
| S4 Flooder | High request volume, skips or fakes the puzzle |
| S5 Payment reuse | Winning bot accounts all try to confirm with the same few cards |
| S6 Mixed | All of the above, with bots at 10, 30 and 50 percent of entries |

Each scenario must also run with individual defences switched off (puzzle, rate limits, scoring) so we can show what each layer adds.

Ground truth: the simulator knows which accounts are bots. Keep labels in the simulator's own output (for example `sim/runs/<runId>/labels.csv` with entryId, isBot, botType). Never send labels to the backend.

## Part 2: Load test (`/load`, k6)
Two flash-crowd shapes against VM 1 from VM 2:
1. Window open burst: thousands of users requesting challenges, logging in and entering in the first minutes
2. Results reveal burst: everyone polling `GET /entries/me` and opening SSE right after the draw
Record p95 and p99 latency, error rate (5xx, excluding intended 429s) and throughput. Ramp to the default scale (50,000 users) or the highest the VM handles, and report which.

## Part 3: Scoring model (`/scoring`, Python with scikit-learn is fine)
Training data comes from simulator runs (features from the database, labels from the simulator).

Features, grouped into the four signal families from PRD 9.2:
- device: how many entries share the fingerprint, and whether that fingerprint appears across many unrelated subnets (common phone model, not a farm)
- ip: entries per /24 subnet compared with the median
- timing: gaps between entries within a cluster, bursts, `pow_server_ms` unusually low
- email: normalised email patterns, sequential numbers, edit distance between local parts, disposable domains, with known institutional domains exempt from the sequential check
Also a cluster feature: size of the group of entries linked by two or more shared signals.

Model: something simple and explainable (logistic regression or gradient boosted trees). Output a probability, turn it into `risk` 0 to 100, then into a weight using the tiers in PRD 9.2:

| Risk | Weight |
|---|---|
| 0-29 | 1.00 |
| 30-59 | 0.50 |
| 60-84 | 0.20 |
| 85-100 | 0.05 |

Keep the two-signal rule as a safety guard: an entry only drops below weight 1.00 if at least two signal families independently look suspicious. This protects honest students on shared hostel networks. If you think it hurts results, show me numbers before removing it.

Generalisation (judges will ask): train on S1, S3, S4, S5 and honest data, and hold out S2 (stealth farm) completely for testing. Report results on the held-out scenario separately.

Scoring service (FastAPI, its own Docker container on VM 1, internal only, see TRD Section 9):
- `POST /score { "dropId": "..." }` returns `{ "scored": n, "flagged": m, "durationMs": t }`. `GET /health` returns ok.
- Refuses unless the drop state is `CLOSED`. The backend calls it once and blocks the draw until it finishes, because the draw builds its manifest from the weights at that moment.
- Loads `/scoring/model/model.joblib`; if missing, uses the fallback rule from PRD 9.2 with the same tiers and guard.
- Writes `risk` and `weight` on each entry (bulk update) and one row per entry in `risk_signals` (entry_id, device, ip, timing, email, cluster_id, cluster_size, reasons as a JSON list of plain-word strings, linked as a JSON list of entry IDs). The table already exists (TRD Section 5); do not change the schema.
- Target: 50,000 entries scored in under a minute on VM 1.

## Part 4: Metrics output
After each run, save `sim/results/<runId>.json` locally and upload it with `POST /admin/runs` (organiser session) in exactly this shape (Jash's dashboard reads it):

```json
{
  "runId": "s2-30pct-2026-10-04T14-10",
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

Definitions:
- botAdvantageRatio = bot share of winners / bot share of entries (targets: at most 0.2 for S1, at most 0.5 for S2)
- botSeatConversion = seats bots confirmed / slots bots won (reported, no target yet)
- honestFairShareDeviation = how far the honest win rate is from seats / honest entries (target: within 10 percent)
- falsePositiveRate = honest entries in the Medium or High tier (target: at most 5 percent)
- drawReproducible = re-running the draw from the published seed and manifest gives the same ranking (reuse the smoke test's ranking function)

## Plan
**By 2 hours:**
1. `/sim` skeleton: config loader, honest users plus S1 naive farm, end-to-end run against the MVP backend, labels file.
2. Feature extraction for the four families, plus the fallback rule, in `/scoring`.
3. Run the smoke test once the backend is up and tell Naytik what fails.

**By 3h30:**
1. All scenarios S0 to S6.
2. Model trained, S2 held out, tiers and two-signal guard applied, reasons written.
3. Scoring service in Docker, working against a real closed drop.
4. k6 scripts for both bursts.

**By 4h15 (feature freeze):**
1. Full runs from VM 2, including defence on/off runs and both k6 bursts.
2. All results uploaded.

**By 5 hours:**
1. One-page summary (`/sim/RESULTS.md`): what we ran, key numbers against targets, the held-out result, hardware used, and honest limitations.

## Do not build
Anything in `/server` or `/web`, real payment or SMS integrations, or extra scenarios before S0 to S6 work. If you think something is missing, tell me first.

Start by proposing the folder structure for `/sim`, `/load` and `/scoring`, then build the 2-hour items in order.
