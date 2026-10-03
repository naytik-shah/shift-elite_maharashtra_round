# Fair Drop web

React + Vite + Tailwind, installable as a PWA (Android, iOS, desktop browsers).

    npm install
    npm run dev

## Backend switch

The UI only talks to `src/api`. Copy `.env.example` to `.env.local` and set

    VITE_API=mock   # everything runs in the browser, no backend needed
    VITE_API=http   # real backend at /api/v1 (dev server proxies /api to localhost:8000)

`src/api/types.ts` mirrors section 10 of the PRD. `http.ts` and `mock.ts` both implement it.

## Screens

Explore (search, categories, closing soonest, open, opening soon, ended), Event (hero, your entry,
about, how it runs, check the draw), Entries (every drop you entered, results needing action first),
Tickets and Account. Sign in and the entry step are bottom sheets over whichever event you are on.

## Mock demo

Six events. The first, Shift Elite Finals Night, squeezes the whole drop into about two minutes,
the rest sit in a fixed phase (open for days, opening soon, ended). The Account tab has demo
controls to pick the outcome (win, waitlist, lose), restart the drop or skip to the draw.
Any six digit code signs you in, `000000` shows the error state, and the UPI ID
`fail@upi` shows a declined payment.

## Layout

    src/api          contract types, http client, mock, error copy
    src/hooks        session, live event stream, countdown, install prompt
    src/lib          proof of work worker, sha256, fingerprint, hash router, theme
    src/components   shell, hero, status panel, sheets, ui primitives
    src/pages        Explore, Event, Entries, Tickets, Account, Register (sign in)

## Built for the flash crowd

- App shell is precached by the service worker, so reloads during the reveal never wait on the origin
- Live status comes over one SSE stream, with Last-Event-ID replay, a heartbeat watchdog and a polling fallback with jittered backoff
- Every mutating call carries an Idempotency-Key that is reused on retry
- Proof of work runs in a Web Worker
- Only the drop page is in the first chunk, other screens load on demand
- System fonts and inline icons, no images or web fonts to fetch

## Needed from the backend

The event pages use fields the PRD drop payload does not have yet: category, venue, city,
description and eventAt (the event date). There is also no single call for my entries, so the
Entries tab asks per drop. A list endpoint would be cheaper under load.
