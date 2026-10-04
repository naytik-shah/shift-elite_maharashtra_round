# Demo crowd

Fills a live drop with honest people and bots so the dashboard has something to show.
Entries stay open afterwards, so the organiser closes, scores and draws from the web app.

```bash
# 1. clear the drop (only for demo drops that already have entries)
cd scripts && FORCE=yes DROP_ID=neon-nights node reset-drop.mjs && cd ..

# 2. send the crowd (about 90 seconds for 2,000 honest people plus bots)
BASE_URL=http://localhost:8080/api/v1 TEST_KEY=<test key> ORGANISER_EMAIL=organiser@fairdrop.test \
  node demo/crowd.mjs neon-nights S6 --honest 2000 --bots 30 --seconds 90
```

Scenarios S0 to S6 are the simulator ones. The crowd uses the test key, so its requests carry their own addresses.
