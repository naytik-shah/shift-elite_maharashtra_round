# Fair Drop: MVP Plan

**Team:** Naytik Shah (Backend), Jash Madhani (Frontend), Zeal Shah (Bot defence and testing)
**Deadlines:** MVP at 2h, presentable version at 6h, final presentation at 9h

**MVP in one line:** people sign up, enter for free, a fair and checkable draw picks winners, winners pay to confirm, seats nobody confirms go to the next person in line, and we can never sell more seats than we have.

Everything that does not depend on Zeal's scripts or model is in the MVP. Zeal's work plugs in later without changing the core.

---

## 1. What a user can do

1. Log in with email and a one-time code sent by email.
2. Open the drop page: seats, countdown, draw time and the published seed hash.
3. Click Enter. Entry is free, one per person. The browser solves a small puzzle first (proof-of-work).
4. Watch the status page update live: Entered, then Won / Waitlisted (with position).
5. Get an email when they win or when they are moved up from the waitlist.
6. If won, pay with a test card within 10 minutes to confirm. The ticket is in the payer's name.
7. If a winner does not confirm in time, the seat goes to the next person on the waitlist.
8. Open the verify page and re-run the draw in the browser to check it was not rigged.

The organiser can:
- Watch a live dashboard: entries, seat slots (pending, confirmed), waitlist left, recent activity.
- Close entries and run the draw (each works only once).
- See the audit log.

## 2. In and out

**In the MVP**
- Email login with real one-time codes (shown on screen only in test mode)
- One drop per config entry, loaded from a config file
- Free entry, one per person
- Proof-of-work puzzles and rate limits
- Fair random draw: seed hash shown before, seed shown after, full ranking saved
- Exactly as many seat slots as seats, created once
- Confirm with a test card, one card per seat, 10 minute confirm window
- Waitlist: expired seats move to the next in line automatically
- Live status updates (SSE), with refresh as a fallback
- Email alerts on win and on promotion
- Draw verify page
- Audit log where each row is chained to the one before it
- Organiser dashboard (without bot flags for now)
- Smoke test script and manual checks (Section 9)

**Not in the MVP (depends on Zeal's work)**

| Feature | When |
|---|---|
| Bot scoring model and down-weighting | When Zeal's model is ready |
| Bot flags and fairness charts on the dashboard | When Zeal's model is ready |
| Bot attack simulator and k6 load test | When Zeal's scripts are ready |
| Group entry (up to 5) | Later, if time allows |

**How Zeal's model plugs in:** after entries close and before the draw, the model writes a `risk` score and a `weight` into each entry. The draw already reads `weight` (1.0 for everyone until then), so nothing else changes.

## 3. Who builds what

**Naytik (backend)**, in this order, so anything that slips is at the bottom:
1. Node + Express + Postgres + Redis in Docker Compose.
2. Tables from Section 4, with the unique rules built in.
3. Load drops from `config/drops.yaml` on startup (create only, never overwrite).
4. Login: email code (sent by email, returned as `devCode` in test mode), session in Redis with a cookie.
5. Enter, status, draw, confirm, close endpoints (Section 5).
6. Draw logic with manifest and full ranking (Section 6).
7. Background job every 10 seconds: expire unconfirmed seats, promote the waitlist, mark the drop complete (Section 7).
8. Live updates over SSE.
9. Proof-of-work and rate limits, plus the test-mode IP header.
10. Audit log.
11. Email alerts.
12. Dashboard and audit endpoints.

**Jash (frontend)**
1. Login page (email, then code).
2. Drop page: seats, countdown, draw time, seed hash, Enter button.
3. Puzzle solver in a Web Worker, and device fingerprint collection.
4. Status page: live updates over SSE, refresh every 5 seconds if SSE drops. Shows Won, Waitlisted (position), Confirmed, Expired, Not selected.
5. Confirm screen: test card, name, countdown to the 10 minute deadline.
6. Verify page: fetches seed and manifest, re-runs the draw in the browser, shows match or mismatch.
7. Organiser dashboard: live counts, Close entries and Run draw buttons, seat slot table, audit log list.

**Zeal (testing and defence)**
1. Bot simulator, k6 load test and the scoring model, against the same API.
2. Run the smoke test once the backend is up (the script is ready, Section 9).

## 4. Database tables

| Table | Columns | Rules |
|---|---|---|
| `users` | id, email, normalised_email, role, created_at | normalised_email is unique |
| `drops` | id, name, seats, state, window_opens_at, window_closes_at, draw_at, confirm_window_min, ticket_price, seed, seed_commit, manifest_hash | state: OPEN, CLOSED, DRAWN, COMPLETE |
| `entries` | id, drop_id, user_id, device_fp, ip, pow_server_ms, created_at, state, risk, weight, rank | unique (drop_id, user_id). weight defaults to 1.0 |
| `seat_slots` | id, drop_id, slot_no, entry_id, state, confirm_by, anchor_hash, payer_name | unique (drop_id, slot_no), unique (drop_id, entry_id), unique (drop_id, anchor_hash) |
| `tickets` | id, slot_id, holder_user_id, payer_name, issued_at | unique (slot_id) |
| `audit_log` | seq, drop_id, type, payload, at, prev_hash, hash | payload is stored as text, not jsonb, so the hash can be recomputed exactly |

States:
- Entry: `ENTERED`, `WON`, `WAITLISTED`, `CONFIRMED`, `EXPIRED`, `NOT_SELECTED`
- Seat slot: `PENDING`, `CONFIRMED`, `UNFILLED` (waitlist ran out)

Notes:
- `device_fp`, `ip` and `pow_server_ms` are saved now for Zeal's model.
- `anchor_hash` is a keyed hash of the test card, never the card itself.
- Use the database clock (`now()`) for every time check.
- node-postgres returns `numeric` columns as strings. Convert weights to numbers before building the manifest.

Redis keys: `sess:<sid>`, `otp:<email>` (code hash and attempts), `pow:<challengeId>`, `rl:<scope>:<key>`, `drop:<id>:events`.

## 5. API

Base path `/api/v1`. Login uses a session cookie. Error format: `{ "error": { "code": "...", "message": "..." } }`.

**Participants**

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/pow/challenge?purpose=otp\|entry` | | 200 `{ challengeId, prefix, difficulty }` | `RATE_LIMITED` |
| POST | `/auth/otp/request` | `{ email, pow: { challengeId, nonce } }` | 202 (plus `devCode` in test mode) | `POW_INVALID`, `RATE_LIMITED` |
| POST | `/auth/otp/verify` | `{ email, code }` | 200, sets cookie | `OTP_INVALID`, `OTP_LOCKED` (after 5 wrong tries) |
| GET | `/me` | | 200 `{ id, email, role }` | `UNAUTHENTICATED` |
| GET | `/drops/:dropId` | | 200 `{ id, name, seats, state, windowOpensAt, windowClosesAt, drawAt, confirmWindowMinutes, ticketPrice, seedCommit }` | `NOT_FOUND` |
| POST | `/drops/:dropId/entries` | `{ pow: { challengeId, nonce }, deviceFingerprint }` | 201 `{ entryId, state }` | `POW_INVALID`, `DROP_NOT_OPEN`, `ALREADY_ENTERED` (409), `RATE_LIMITED` |
| GET | `/drops/:dropId/entries/me` | | 200 `{ entryId, state, rank, waitlistPosition, confirmBy }` | `NOT_FOUND` |
| GET | `/drops/:dropId/events` | | SSE stream: `your_status`, `drop_state`, `heartbeat` | |
| POST | `/drops/:dropId/entries/me/confirm` | `{ testCard, payerName }` | 200 `{ ticket }` | `NOT_A_WINNER` (403), `ALREADY_CONFIRMED` (409), `ANCHOR_ALREADY_USED` (409), `CONFIRM_WINDOW_EXPIRED` (410) |

**Draw verification (public)**

| Method | Path | Success |
|---|---|---|
| GET | `/drops/:dropId/draw` | 200 `{ seedCommit, seed, manifestHash }` (seed and manifestHash are null before the draw) |
| GET | `/drops/:dropId/draw/manifest` | 200 `{ entries: [ { entryId, weight } ] }` |
| GET | `/drops/:dropId/draw/results` | 200 `{ ranking: [ entryId, ... ], seats }` |

**Organiser**

| Method | Path | Success | Errors |
|---|---|---|---|
| POST | `/admin/drops/:dropId/close` | 200 | `INVALID_STATE` (409) |
| POST | `/admin/drops/:dropId/draw` | 200 `{ seed, manifestHash }` | `INVALID_STATE` (409) |
| GET | `/admin/drops/:dropId/live` | 200 `{ state, seats, entries, slotsPending, slotsConfirmed, slotsUnfilled, waitlistLeft }` | |
| GET | `/admin/audit?dropId=` | 200 `{ events: [ { seq, type, payload, at, prevHash, hash } ] }` | |

Organisers are the emails listed under `organisers` in the config file.

**Test mode** (`TEST_MODE=true`, never on the live link):
- `/auth/otp/request` returns `devCode`, and emails to `@fairdrop.test` are not sent.
- The `X-Test-Client-IP` header is treated as the client IP, so the test script's users do not all share one IP and hit rate limits.
- `POW_DIFFICULTY` can be lowered so the script runs fast.

**Rate limits and puzzles:** use the defaults in PRD Section 9.3 and 9.4. The puzzle is: find a `nonce` such that `SHA-256(prefix + nonce)` starts with `difficulty` zero bits. Record the server-side time from issuing the challenge to receiving the answer as `pow_server_ms`.

## 6. How the draw works

Everyone can recompute this, so follow it exactly.

1. When the drop is created: `seed` = 32 random bytes as a 64-character hex string. `seedCommit` = SHA-256 of the seed string, as hex. Show `seedCommit` on the drop page.
2. Close: `UPDATE drops SET state = 'CLOSED' WHERE id = $1 AND state = 'OPEN'`. No row changed means `INVALID_STATE`.
3. Draw, all in one transaction:
   1. `UPDATE drops SET state = 'DRAWN' WHERE id = $1 AND state = 'CLOSED'`. No row changed means `INVALID_STATE`. This makes double clicks safe.
   2. Manifest: all entries as `{ entryId, weight }` (in that key order), sorted by entryId. `manifestHash` = SHA-256 of `JSON.stringify(manifestEntries)`, as hex.
   3. For each entry: `h` = HMAC-SHA256 with key = seed string, message = entryId, as hex. `u = (parseInt(first 13 hex chars of h, 16) + 1) / (2^52 + 1)`. `key = ln(u) / weight`.
   4. Sort by key, biggest first. Ties go to the smaller entryId. Save `rank` (1 = first).
   5. Ranks 1 to N (N = seats) become `WON`, the rest `WAITLISTED`.
   6. Insert one `seat_slots` row per winner: `state = 'PENDING'`, `confirm_by = now() + confirm window`.
   7. Save `manifest_hash`, reveal `seed`, write audit rows, send win emails after commit.

**Confirm** is one statement:

```sql
UPDATE seat_slots
SET state = 'CONFIRMED', anchor_hash = $1, payer_name = $2
WHERE drop_id = $3 AND entry_id = $4
  AND state = 'PENDING' AND confirm_by > now()
RETURNING id;
```

- Unique violation on `anchor_hash`: return `ANCHOR_ALREADY_USED`.
- No row returned: check why and return `ALREADY_CONFIRMED`, `NOT_A_WINNER` or `CONFIRM_WINDOW_EXPIRED`.
- On success: entry becomes `CONFIRMED`, ticket is issued, audit row written.
- The test card always succeeds in the MVP.

## 7. Waitlist job (every 10 seconds)

Runs in one place at a time (Postgres advisory lock).

1. Find slots with `state = 'PENDING' AND confirm_by <= now()`.
2. For each, in one transaction:
   - Mark the current entry `EXPIRED`.
   - Pick the `WAITLISTED` entry with the smallest rank.
   - If found: `UPDATE seat_slots SET entry_id = <next>, confirm_by = now() + window WHERE id = $1 AND state = 'PENDING' AND confirm_by <= now()`, mark that entry `WON`, write audit row, send promotion email and SSE update.
   - If the waitlist is empty: mark the slot `UNFILLED`.
3. When no `PENDING` slots are left: remaining `WAITLISTED` entries become `NOT_SELECTED` and the drop becomes `COMPLETE`.

`waitlistPosition` = number of `WAITLISTED` entries with a smaller rank, plus 1.

## 8. Audit log

Every important action writes a row: entry, close, draw, confirm, expiry, promotion, complete.

- `payload` is a JSON string saved as text.
- `hash` = SHA-256 of `prev_hash + "|" + seq + "|" + type + "|" + payload`, as hex.
- The first row uses 64 zeros as `prev_hash`.
- If anyone edits a row, every hash after it stops matching.

## 9. Testing the MVP

### 9.1 Config for testing

`config/drops.yaml`

```yaml
organisers:
  - organiser@fairdrop.test

drops:
  - id: launch-night
    name: Launch Night
    seats: 500
    window_opens_at: "2026-10-04T10:00:00+05:30"
    window_closes_at: "2026-10-04T18:00:00+05:30"
    draw_at: "2026-10-04T20:00:00+05:30"
    confirm_window_min: 10
    ticket_price: 500

  - id: smoke-test
    name: Smoke Test Drop
    seats: 10
    window_opens_at: "2026-10-04T00:00:00+05:30"
    window_closes_at: "2026-10-05T00:00:00+05:30"
    draw_at: "2026-10-05T00:30:00+05:30"
    confirm_window_min: 1
    ticket_price: 500
```

The `smoke-test` drop has 10 seats (so 100 users means real winners and a real waitlist) and a 1 minute confirm window (so the test can watch a seat expire and move down the waitlist).

### 9.2 Smoke test script

`scripts/mvp-smoke-test.mjs` runs the whole flow and checks the database directly.

```bash
cd scripts
npm install pg
BASE_URL=http://localhost:3000/api/v1 \
DATABASE_URL=postgres://fairdrop:fairdrop@localhost:5432/fairdrop \
DROP_ID=smoke-test \
ORGANISER_EMAIL=organiser@fairdrop.test \
USERS=100 \
node mvp-smoke-test.mjs
```

The backend must run with `TEST_MODE=true` and a low `POW_DIFFICULTY` (for example 12).

It checks:
1. 100 users log in (solving puzzles) and enter.
2. A second entry from each user is rejected.
3. An entry after close is rejected.
4. Two Run draw clicks at the same moment: exactly one works.
5. The revealed seed matches the hash shown before the draw.
6. The manifest matches its hash, and re-running the draw gives the same ranking.
7. Winners = seats, everyone else is waitlisted with positions 1, 2, 3 and so on.
8. Two winners confirming with the same card at the same moment: exactly one works.
9. A waitlisted user cannot confirm. A winner cannot confirm twice.
10. One winner is left unconfirmed on purpose: after 1 minute their seat goes to waitlist #1, who can then confirm.
11. Once all seats are confirmed, the drop completes and the rest become Not selected.
12. Database: slots equal min(seats, entries) and never more, no card holds two seats, no user has two entries, tickets match confirmed seats, the audit chain is unbroken.

Each check prints PASS, FAIL or SKIP. SKIP means that part is not built yet (for example the puzzle endpoint returns 404), so the script can be used while the backend is still being built. It exits with an error if anything fails. Reset the smoke-test drop before running it again.

### 9.3 Manual checks (in the browser)

- [ ] Real email code arrives and works. Wrong code 5 times locks it.
- [ ] Enter, refresh the page: still shows Entered.
- [ ] Click Enter twice quickly: one entry only.
- [ ] Status changes to Won or Waitlisted without refreshing (SSE). Turn off Wi-Fi briefly: it recovers.
- [ ] Win email arrives.
- [ ] Two browsers, two winners, same test card: second confirm fails.
- [ ] Do not confirm a win: after the window, the next person gets the seat and an email.
- [ ] Double-click Run draw: runs once.
- [ ] Verify page shows a match.
- [ ] Dashboard counts match the database. Confirmed seats never exceed seats.

### 9.4 Quick database checks

```sql
-- seats used vs seats available
SELECT d.seats, COUNT(s.id) AS slots,
       COUNT(*) FILTER (WHERE s.state = 'CONFIRMED') AS confirmed
FROM drops d LEFT JOIN seat_slots s ON s.drop_id = d.id
WHERE d.id = 'smoke-test' GROUP BY d.seats;

-- any card used twice (should return nothing)
SELECT anchor_hash, COUNT(*) FROM seat_slots
WHERE drop_id = 'smoke-test' AND anchor_hash IS NOT NULL
GROUP BY anchor_hash HAVING COUNT(*) > 1;

-- any user entered twice (should return nothing)
SELECT user_id, COUNT(*) FROM entries
WHERE drop_id = 'smoke-test'
GROUP BY user_id HAVING COUNT(*) > 1;
```

## 10. Demo (3 minutes)

1. Drop page with the seed hash.
2. Run the smoke test: 100 users enter.
3. Close entries, run the draw, double-click to show it only runs once.
4. Verify page: the draw re-runs in the browser and matches.
5. Confirm as a winner. Try the same card as a second winner: rejected.
6. Leave a win unconfirmed: watch the seat move to the next person live on the dashboard.
7. Database checks and the audit chain: never more seats than available, no card used twice, no edits.

## 11. Done when

- [ ] Smoke test script passes every check, no SKIPs
- [ ] Manual checks pass
- [ ] Demo runs start to finish without touching the database by hand
- [ ] Code is committed by the team (no pushes without a review by Naytik)
