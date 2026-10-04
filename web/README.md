# Fair Drop web

React + Vite app for Fair Drop: participant pages, the public verify page and the organiser dashboard.
Installable as a PWA (Android, iOS, desktop browsers).

    npm install
    npm run dev

## Backend switch

The UI only talks to `src/api`. Copy `.env.example` to `.env.local` and set

    VITE_API=mock   # everything runs in the browser, no backend needed
    VITE_API=http   # real backend at /api/v1

In dev the Vite server proxies `/api` to `http://localhost:3000`, so the app and the API share one
origin and the session cookie works. In production nginx serves `dist` and `/api` from the same domain.

`src/api/types.ts` mirrors section 10 of `docs/PRD.md`. `http.ts` and `mock.ts` both implement it.

## Pages

    #/                    drop list
    #/drop/:id            drop page: countdown, seed hash, Enter, live status, confirm
    #/status              my status across drops
    #/verify, /verify/:id runs the draw again in the browser, MATCH or MISMATCH
    #/tickets             confirmed tickets
    #/dashboard/:id       organiser only: live counts, close, scoring, draw, slots, audit, flags, fairness
    #/account             theme, install, log out

## How the parts work

- Puzzle: `src/lib/pow.worker.ts` finds the smallest nonce in a Web Worker with `js-sha256`.
  A `POW_INVALID` answer gets a fresh puzzle and one retry (`src/lib/pow.ts`).
- Fingerprint: SHA-256 of userAgent, language, timezone, screen size and depth, hardwareConcurrency, platform.
- Live status: one SSE stream per open drop page. If it drops, status is read every 5 seconds until
  it reconnects. Status is always loaded on page load, so a refresh shows the right state.
- Verify: `src/lib/draw.ts` is the draw exactly as PRD 9.1, run in `verify.worker.ts`.
- Every mutating call sends `Content-Type: application/json` and an `Idempotency-Key`, and its
  button is disabled while the request runs.

## Mock

Four drops. Launch Night closes and draws on its own about two minutes after the mock is created.
Smoke Test Drop waits for the organiser. Campus Fest Night has not opened. Winter Gala is finished,
so the verify page has something to check straight away. Other entrants are simulated, and the
draw, waitlist and audit chain follow the same rules as the backend.

- Log in with any email, the code is shown on screen (as in test mode).
- Log in as `organiser@fairdrop.test` for the dashboard.
- Test card `4000 0000 0000 0002` shows the card already used error.
- Account has Restart demo and Skip to draw.

## Build

    npm run build     # output in dist
