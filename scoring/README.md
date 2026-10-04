# Scoring model and service

Scores every entry of a closed drop on four signal families (device, ip, timing, email)
plus a cluster feature, turns the result into a risk from 0 to 100, then into a draw weight.

| Risk | Weight |
|---|---|
| 0-29 | 1.00 |
| 30-59 | 0.50 |
| 60-84 | 0.20 |
| 85-100 | 0.05 |

Two-signal guard: an entry only drops below 1.00 if at least two families score 0.5 or more.
Otherwise its risk is capped at 29. Set `TWO_SIGNAL_GUARD=0` to switch the guard off.

Without `model/model.joblib` the service uses the fixed rule from PRD 9.2:
`risk = 100 x (0.35 device + 0.25 ip + 0.20 timing + 0.20 email)` plus a cluster bonus.

## Files

- `features.py`: feature extraction and clusters
- `scoring.py`: tiers, guard, fallback rule, reasons
- `app.py`, `db.py`: FastAPI service and database access
- `train.py`, `evaluate.py`, `export_entries.py`: offline training and checks

## Training workflow (on VM 2, after simulator runs)

```bash
pip install -r requirements.txt
export DATABASE_URL=postgres://fairdrop_ro:...@<VM1_INTERNAL_IP>:5432/fairdrop
python export_entries.py ../simulator/runs/*          # writes entries.csv in each run folder
python evaluate.py ../simulator/runs/* --fallback     # fallback rule, no training
python train.py ../simulator/runs/*                   # trains, saves model/model.joblib, prints a report
```

`train.py` trains on S0, S1, S3, S4 and S5 runs and never trains on the held-out scenario
(default S2) or on S6 runs, which contain it. Options: `--kind logreg|gbt`,
`--holdout S2`, `--train-scenarios S0,S1,S3,S4`.

S5 bots enter in the same stealthy way as S2 bots, so training on S5 leaks S2 behaviour.
Run once with `--train-scenarios S0,S1,S3,S4` to get the strictly held-out number.

`evaluate.py` and the report show each run with the guard on and off:
`bot_lowered` (share of bots below weight 1.0), `false_positive_rate` (honest entries at
Medium or High), and `weighted_advantage` (bots' share of total weight over their share of
entries, a quick stand-in for the bot advantage ratio). The simulator's results file has the final numbers.

## Service

`POST /score {"dropId": "..."}` returns `{"scored": n, "flagged": m, "durationMs": t}`.
It refuses unless the drop is `CLOSED` (409), returns 404 for an unknown drop, and writes
`entries.risk`, `entries.weight` and one `risk_signals` row per entry in one transaction.
`GET /health` returns `{"ok": true, "model": <bool>}`.

The backend calls it from `/admin/drops/:id/score` when `SCORING_URL=http://scoring:8000` is set
(the compose file in `deploy/` needs the `scoring` service below).

Environment: `DATABASE_URL` (full access user), `MODEL_PATH` (default `/app/model/model.joblib`),
optional `INSTITUTIONAL_DOMAINS` (comma list of suffixes exempt from the sequential email
check) and `DISPOSABLE_DOMAINS_PATH` (one domain per line).

Compose entry for VM 1 (internal network only, no published port):

```yaml
  scoring:
    build: ./scoring
    environment:
      DATABASE_URL: postgres://fairdrop:<password>@postgres:5432/fairdrop
    volumes:
      - ./scoring/model:/app/model:ro
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
      interval: 10s
```

## Notes

- `linked` holds at most 50 entry ids per entry.
- Clusters link entries that share at least two of: device fingerprint, /24 subnet, exact IP, email series.
- Near-duplicate emails are compared with the next entry in sorted order, not all pairs.
