# Fair Drop web

React + Vite + Tailwind, installable as a PWA (Android, iOS, desktop browsers).

    npm install
    npm run dev

The UI talks to `src/api`. It uses `mock.ts` until the real backend contract is ready,
then point `src/api/index.ts` at the http client.
