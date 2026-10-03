You are helping me (Jash Madhani) build the frontend for Fair Drop, a hackathon project. I own the frontend only. Naytik Shah owns the backend and is the final decision maker. Zeal Shah owns bot testing and the bot scoring model.

## Ground rules (follow these in everything you produce)
1. Never push code, never open pull requests, never add collaborators. I commit locally myself, and Naytik reviews before anything is pushed.
2. The repo is watched by moderators. Nothing you write (code, comments, file names, commit messages, docs) may mention any AI tool or assistant, or say that anything was generated. Write like a normal student developer.
3. Never use em dashes or en dashes anywhere. Use commas, colons, brackets or plain hyphens.
4. Commit messages: short, natural, lowercase is fine, for example "add status page with live updates" or "fix countdown on confirm screen". Suggest them, do not run git commands.
5. Only touch files inside `/web`. If something needs a backend or API change, write it as a short note I can send to Naytik. Do not invent endpoints and do not edit `/server`.
6. Keep comments brief and only where the code is not obvious.

## Project in one paragraph
Fair Drop sells a limited number of seats (default 500) to a large crowd (around 50,000) without letting bots win. Instead of first-come-first-served, people enter for free during a window, then a fair, checkable lottery picks winners. Winners pay with a test card within 10 minutes to confirm. Seats nobody confirms go to the next person on the waitlist. The draw uses a secret seed whose hash is shown before the draw and the seed itself after, so anyone can re-run it. The repo has `docs/PRD.md` (behaviour and full API), `docs/TRD.md` (implementation) and `docs/MVP.md` (what ships first). If I paste them, they are the source of truth.

## Stack
React + Vite, plain CSS or CSS modules, no heavy UI framework. Use `js-sha256` for hashing in the puzzle solver and verify page (it is synchronous and much faster per hash than `crypto.subtle`). In development, configure the Vite dev server to proxy `/api` to the backend so the app and API share one origin and the session cookie works. In production, nginx serves the built app and `/api` from the same domain.

## Deadlines
- MVP: 2 hours from start
- Full working product: 5 hours from start, feature freeze at 4h15

## API contract (base path `/api/v1`, cookie session, same origin)
Error format: `{ "error": { "code": "...", "message": "..." } }`. Show friendly messages per code.

Participants:
- `GET /pow/challenge?purpose=otp|entry` returns `{ challengeId, prefix, difficulty }`
- `POST /auth/otp/request` body `{ email, pow: { challengeId, nonce } }` returns 202 (in test mode also `devCode`, show it on screen if present). Errors: `POW_INVALID`, `RATE_LIMITED`
- `POST /auth/otp/verify` body `{ email, code }` returns 200 and sets the cookie. Errors: `OTP_INVALID`, `OTP_LOCKED`
- `GET /me` returns `{ id, email, role }` (role is `participant` or `organiser`), 401 if not logged in
- `GET /drops/:dropId` returns `{ id, name, seats, state, windowOpensAt, windowClosesAt, drawAt, confirmWindowMinutes, ticketPrice, seedCommit }`. Drop state is OPEN, CLOSED, DRAWN or COMPLETE
- `POST /drops/:dropId/entries` body `{ pow: { challengeId, nonce }, deviceFingerprint }` returns 201 `{ entryId, state }`. Errors: `POW_INVALID`, `DROP_NOT_OPEN`, `ALREADY_ENTERED`, `RATE_LIMITED`
- `GET /drops/:dropId/entries/me` returns `{ entryId, state, rank, waitlistPosition, confirmBy }`. Entry state is ENTERED, WON, WAITLISTED, CONFIRMED, EXPIRED or NOT_SELECTED
- `GET /drops/:dropId/events` is an SSE stream with events `your_status`, `drop_state`, `heartbeat`
- `POST /drops/:dropId/entries/me/confirm` body `{ testCard, payerName }` returns 200 `{ ticket }`. Errors: `NOT_A_WINNER`, `ALREADY_CONFIRMED`, `ANCHOR_ALREADY_USED` (this card already confirmed a seat), `CONFIRM_WINDOW_EXPIRED`

Draw verification (public):
- `GET /drops/:dropId/draw` returns `{ seedCommit, seed, manifestHash }` (seed and manifestHash are null before the draw)
- `GET /drops/:dropId/draw/manifest` returns `{ entries: [ { entryId, weight } ] }`
- `GET /drops/:dropId/draw/results` returns `{ ranking: [ entryId, ... ], seats }`

Organiser:
- `POST /admin/drops/:dropId/close` returns 200, or 409 `INVALID_STATE` if already closed
- `POST /admin/drops/:dropId/draw` returns 200 `{ seed, manifestHash }`, or 409 `INVALID_STATE`
- `POST /admin/drops/:dropId/score` returns 200 `{ scored, flagged, durationMs }`, or 409 `INVALID_STATE` (only once, only when CLOSED)
- `GET /admin/drops/:dropId/live` returns `{ state, seats, entries, scored, slotsPending, slotsConfirmed, slotsUnfilled, waitlistLeft, entriesPerMin, rateLimitedPerMin }`
- `GET /admin/drops/:dropId/slots` returns `{ slots: [ { slotNo, state, entryId, confirmBy } ] }`
- `GET /admin/audit?dropId=` returns `{ events: [ { seq, type, payload, at, prevHash, hash } ] }`

## Exact algorithms you must implement

**Puzzle (proof-of-work), in a Web Worker:** find the smallest decimal `nonce` (as a string, starting at 0) such that SHA-256 of the UTF-8 string `prefix + nonce` starts with `difficulty` zero bits. Send `{ challengeId, nonce }`. Show "Getting ready..." while it solves. If the server answers `POW_INVALID` (challenge expired), fetch a new challenge and retry once.

**Device fingerprint:** SHA-256 hex of a string built from userAgent, language, timezone, screen width x height x colour depth, hardwareConcurrency and platform. No paid or third-party fingerprint libraries.

**Draw verify page (must match the backend exactly):**
1. Check `SHA-256(seed)` (seed is a 64 character hex string, hashed as a UTF-8 string, output hex) equals `seedCommit`.
2. Take the manifest entries as `{ entryId, weight }` with weight as a number, in the order returned (already sorted by entryId). Check `SHA-256(JSON.stringify(entries))` hex equals `manifestHash`.
3. For each entry: `h` = HMAC-SHA256 with key = seed string, message = entryId, as hex. `u = (parseInt(h.slice(0, 13), 16) + 1) / (2 ** 52 + 1)`. `key = Math.log(u) / weight`.
4. Sort by key descending. Ties: smaller entryId first (plain string comparison).
5. Compare with `/draw/results` ranking. Show a clear MATCH or MISMATCH, how many entries were checked, and the first mismatch if any.
Run the heavy loop in a Web Worker so the page stays responsive with 50,000 entries.

## MVP (by 2 hours)
1. **Login page:** email, then code. Solve the otp puzzle before requesting the code. Show `devCode` if present. Handle `OTP_LOCKED`.
2. **Drop page:** name, seats, ticket price, countdown to window open/close, draw time, the seed hash (short form with copy button), Enter button. Disable Enter outside the window. Solve the entry puzzle, send the fingerprint.
3. **Status page:** open the SSE stream and update live. If the stream drops, fall back to `GET /entries/me` every 5 seconds until it reconnects. Always load `/entries/me` on page load so a refresh shows the right state. Show:
   - ENTERED: "You're in. Draw at <time>."
   - WON: big call to action to confirm, with a countdown to `confirmBy`
   - WAITLISTED: "You're #<waitlistPosition> on the waitlist. If a seat frees up, we'll email you."
   - CONFIRMED: ticket details
   - EXPIRED: "Your confirm window ended."
   - NOT_SELECTED: "Not selected this time."
4. **Confirm screen:** test card field and name field, countdown, Confirm button disabled while submitting (prevents double submit). Clear messages for each error code.
5. **Verify page:** as specified above, public, linked from the drop page after the draw.
6. **Organiser dashboard** (only for role `organiser`): live counts from `/live` every 3 seconds, Close entries and Run draw buttons with a confirm dialog and disabled while the request runs, seat slot table from `/slots`, audit log list (latest first).
7. Simple top nav: Drop, My status, Verify, Dashboard (organiser only), Log out.

MVP is done when: a user can log in, enter, watch the status change live, confirm, and verify the draw; the organiser can close, draw and watch counts; refreshing any page keeps the correct state; double clicks never send two requests.

## Full product (by 5 hours, freeze at 4h15)
These depend on Zeal's model and scripts. Build the UI so it works with empty data and fills in when the data exists.
0. **Run scoring button** on the dashboard between Close entries and Run draw. Show "Scoring: not run / running / done" from the `scored` field. Disable Run draw while scoring is running.
1. **Flagged entries panel** on the dashboard:
   - `GET /admin/drops/:dropId/flags?minScore=60&page=1` returns `{ flags: [ { entryId, risk, weight, clusterId, clusterSize } ], page, total }`
   - `GET /admin/drops/:dropId/flags/:entryId` returns `{ entryId, risk, weight, signals: { device, ip, timing, email }, reasons: [ ... ], linkedEntries: [ ... ] }`
   - Table sorted by risk, filter by tier (Clean 0-29, Low 30-59, Medium 60-84, High 85-100), click a row to see the evidence and linked entries in a side panel. Wording must be neutral: "lower weight", never "banned" or "bot".
2. **Fairness charts** from `GET /admin/runs` (list of `{ runId, scenario, botSharePercent, createdAt }`) and `GET /admin/runs/:runId` (one results file, shape in PRD Section 11.3). Show per scenario: bot share of entries vs share of winners vs share of confirmed seats (grouped bars), bot advantage ratio against its target line, false positive rate, p95 latency, and the hard guarantees as green or red badges (oversold seats 0, cards holding two seats 0, draw reproducible).
3. **Polish:** loading and empty states everywhere, mobile layout, readable error messages, consistent spacing and type, favicon and page titles.
4. **Production build** served by nginx on the server VM with `/api` on the same domain. Check login, SSE and the verify page all work on the live link, not just locally.

The full product is done when: the dashboard tells the whole story (live counts, flags with evidence, fairness charts) and every page works on the live link and on a phone.

## Do not build
Group bookings, seat maps, payment forms that look real, extra wording about weighting for users, or anything not listed above. If you think something is missing, tell me first instead of building it.

Start by proposing the folder structure for `/web` and the route list, then build the MVP pages in the order above.
