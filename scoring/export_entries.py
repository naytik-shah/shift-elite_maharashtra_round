"""Save a run's entry data to entries.csv next to its labels, so training can run offline.

usage: DATABASE_URL=postgres://fairdrop_ro:...@host:5432/fairdrop python export_entries.py ../simulator/runs/<runId> [...]
"""
import json
import os
import sys
from pathlib import Path

import db


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    with db.connect(os.environ["DATABASE_URL"]) as conn:
        for p in sys.argv[1:]:
            run = Path(p)
            drop_id = json.loads((run / "run.json").read_text())["dropId"]
            df = db.load_entries(conn, drop_id)
            df.to_csv(run / "entries.csv", index=False)
            print(f"{run.name}: {len(df)} entries")


if __name__ == "__main__":
    main()
