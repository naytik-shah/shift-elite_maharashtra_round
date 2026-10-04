"""Train the scoring model on simulator runs and hold out the stealth farm.

usage: python train.py ../simulator/runs/* [--kind logreg|gbt] [--holdout S2]
Runs of scenarios S1, S3, S4, S5 and honest S0 are used for training. Runs of the
held-out scenario (and S6, which contains it) are only scored, never trained on.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import config
from evaluate import evaluate_runs, load_run
from features import FEATURE_COLUMNS, build_features, to_matrix

TRAIN_SCENARIOS = {"S0", "S1", "S3", "S4", "S5"}


def make_model(kind):
    if kind == "gbt":
        return HistGradientBoostingClassifier(max_depth=3, max_iter=150, learning_rate=0.1, random_state=0)
    return make_pipeline(StandardScaler(), LogisticRegression(C=1.0, max_iter=2000))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--kind", default="logreg", choices=["logreg", "gbt"])
    ap.add_argument("--holdout", default="S2")
    ap.add_argument("--train-scenarios", default=",".join(sorted(TRAIN_SCENARIOS)))
    ap.add_argument("--out", default="model/model.joblib")
    a = ap.parse_args()

    runs = [load_run(p) for p in a.runs if (Path(p) / "entries.csv").exists()]
    holdout = a.holdout.upper()
    wanted = {s.strip().upper() for s in a.train_scenarios.split(",")}
    train = [r for r in runs if r["meta"]["scenario"] in wanted and r["meta"]["scenario"] != holdout]
    test = [r for r in runs if r not in train]
    if not train:
        sys.exit("no training runs found (need S0, S1, S3, S4 or S5 runs with entries.csv)")

    xs, ys = [], []
    for r in train:
        feat = build_features(r["entries"])
        y = r["labels"]["isBot"].reindex(feat["id"]).to_numpy()
        ok = ~np.isnan(y)
        xs.append(to_matrix(feat)[ok])
        ys.append(y[ok].astype(int))
    X, y = np.vstack(xs), np.concatenate(ys)
    if y.sum() == 0 or y.sum() == len(y):
        sys.exit("training data needs both honest and bot entries")

    model = make_model(a.kind)
    model.fit(X, y)
    print(f"trained {a.kind} on {len(train)} runs, {len(y)} entries, {int(y.sum())} bots")

    # Risk cut-offs come from the honest entries of the training runs only: their 99th, 99.7th and 99.9th
    # percentile probability map to risk 30, 60 and 85. Held-out and mixed runs never choose them.
    honest_p = model.predict_proba(X[y == 0])[:, 1]
    cutoffs = [float(c) for c in np.percentile(honest_p, config.CUTOFF_PERCENTILES)]
    print(f"cut-offs from {len(honest_p)} honest training entries at {list(config.CUTOFF_PERCENTILES)}: {cutoffs}")

    bundle = {
        "model": model,
        "features": FEATURE_COLUMNS,
        "kind": a.kind,
        "cutoffs": cutoffs,
        "cutoff_percentiles": list(config.CUTOFF_PERCENTILES),
        "trained_on": [r["meta"]["runId"] for r in train],
        "held_out": holdout,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, out)
    print("saved", out)

    if a.kind == "logreg":
        coef = model[-1].coef_[0]
        top = sorted(zip(FEATURE_COLUMNS, coef), key=lambda p: -abs(p[1]))[:8]
        print("largest coefficients:", ", ".join(f"{k} {v:+.2f}" for k, v in top))

    report = {}
    pd.set_option("display.width", 200)
    pd.set_option("display.max_columns", 20)
    for name, group in (("training runs (seen)", train), (f"held-out {holdout} and mixed runs", test)):
        if not group:
            continue
        table = evaluate_runs(group, bundle)
        report[name] = table.to_dict(orient="records")
        print(f"\n{name}")
        print(table.drop(columns=["run"]).to_string(index=False))
    out.with_name("report.json").write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
