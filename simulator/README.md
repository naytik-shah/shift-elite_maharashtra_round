# Bot simulator

Runs one scenario against the real API: builds honest and bot accounts, logs them in,
enters during the window, closes, scores, draws, confirms seats, then computes the
fairness numbers and uploads the results file.

## Setup (VM 2)

```bash
cd simulator
npm install
cp .env.example .env   # fill in, then: set -a; . ./.env; set +a
```

Needs `BASE_URL`, `TEST_KEY`, `ORGANISER_EMAIL` and (for the hard guarantee checks)
`DATABASE_URL` with the read-only user. Never commit `.env`.

## Run

```bash
node src/cli.js config/s1-naive-farm.yaml
node src/cli.js config/s6-mixed.yaml --set botSharePercent=50
node src/cli.js config/s2-stealth-farm.yaml --set defences.scoring=false
node src/cli.js config/s1-naive-farm.yaml --dry     # print the population only
```

Flags: `--dry` (no network), `--no-db` (skip database checks), `--no-upload`.
`--set a.b=c` overrides any config key.

Each run needs a clean OPEN drop. The configs use the `test-load` drop (500 seats, see
`config/drops.test.yaml`). Reset it before every run, from the repo root on the machine that
can reach the server's database and Redis:

```bash
DROP_ID=test-load node scripts/reset-drop.mjs
```

The drop's window must be longer than `windowSeconds` plus a few seconds. `test-load` has a
10 minute confirm window, so promotion rounds wait that long. For a quick run use
`--set reveal.maxRounds=1`, or use a drop with a 1 minute confirm window.

## Output

- `runs/<runId>/labels.csv`: entryId, isBot, botType (never sent to the server)
- `runs/<runId>/run.json`: run metadata (drop id, scenario, defences)
- `runs/<runId>/summary.json`: outcomes per account type, HTTP codes, draw checks
- `results/<runId>.json`: the results file, uploaded to `POST /admin/runs`

## Scenarios

| Config | Bot behaviour |
|---|---|
| S0 | none |
| S1 | one device, one subnet, fixed cadence, sequential emails, 5 cards |
| S2 | rotated IPs and subnets, random timing, varied emails and devices, 40 cards |
| S3 | hammers code requests and entry submissions from a few IPs |
| S4 | floods with fake or missing puzzle answers |
| S5 | stealth entry, then all winners confirm with 3 cards |
| S6 | mix of all five (share set by `botSharePercent`: 10, 30, 50) |

Honest users have their own IP, device and card. About 8 percent sit on shared
college subnets, and about 10 percent share one of 15 common device fingerprints.

## Defence switches

- `defences.scoring=false`: the simulator skips `/score`, so all weights stay 1.0.
- `defences.pow` and `defences.rateLimits` are server settings: `POW_ENABLED` and
  `RATE_LIMITS_ENABLED` in the server environment (restart the API containers after changing them).
  Set the same flag here so the results file says what was on.
- `TEST_POW_DIFFICULTY` on the server sets how hard the puzzles are for test requests.

## Notes

- All emails use `@fairdrop.test` by default, because the server skips real email only
  for addresses ending in `@fairdrop.test` (subdomains do not count).
- Defence flags in the results file are labels only for pow and rate limits.
- Metrics follow PRD section 11.2. Medium and High tiers are weights of 0.20 or lower
  in the published manifest. `honestFairShareDeviation` compares honest winners with
  min(seats, honest entries).
