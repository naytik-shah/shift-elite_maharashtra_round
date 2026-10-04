"""Score simulator runs offline and print detection numbers.

usage: python evaluate.py ../simulator/runs/* [--model model/model.joblib] [--fallback]
Each run folder needs entries.csv (see export_entries.py), labels.csv and run.json.
"""
import argparse
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

import config
from features import build_features
from scoring import score_features


def load_run(path):
    p = Path(path)
    meta = json.loads((p / "run.json").read_text())
    entries = pd.read_csv(p / "entries.csv", dtype={"device_fp": str})
    labels = pd.read_csv(p / "labels.csv").set_index("entryId")
    return {"dir": p, "meta": meta, "entries": entries, "labels": labels}


def summarize(res, labels):
    y = labels["isBot"].reindex(res["id"]).to_numpy()
    keep = ~np.isnan(y)
    y = y[keep].astype(int)
    w = res["weight"].to_numpy()[keep]
    risk = res["risk"].to_numpy()[keep]
    bot = y == 1
    out = {"entries": int(len(y)), "bots": int(bot.sum())}
    out["auc"] = round(float(roc_auc_score(y, risk)), 3) if bot.any() and (~bot).any() else None
    out["bot_lowered"] = round(float((w[bot] < 1).mean()), 3) if bot.any() else None
    out["bot_medium_high"] = round(float((w[bot] <= 0.2).mean()), 3) if bot.any() else None
    out["honest_lowered"] = round(float((w[~bot] < 1).mean()), 4)
    out["false_positive_rate"] = round(float((w[~bot] <= 0.2).mean()), 4)
    # bots' share of total weight over their share of entries, a stand-in for the advantage ratio
    out["weighted_advantage"] = round(float((w[bot].sum() / w.sum()) / bot.mean()), 3) if bot.any() else None
    return out


def evaluate_runs(runs, bundle):
    rows = []
    for r in runs:
        feat = build_features(r["entries"])
        for guard in (True, False):
            res = score_features(feat, bundle, guard=guard, with_reasons=False)
            s = summarize(res, r["labels"])
            rows.append(
                {"run": r["meta"]["runId"], "scenario": r["meta"]["scenario"],
                 "share": r["meta"]["botSharePercent"], "guard": guard, **s}
            )
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--model", default=config.MODEL_PATH)
    ap.add_argument("--fallback", action="store_true", help="ignore the trained model")
    a = ap.parse_args()

    bundle = None
    if not a.fallback and Path(a.model).exists():
        bundle = joblib.load(a.model)
    print("scoring with:", "trained model" if bundle else "fallback rule")

    runs = [load_run(p) for p in a.runs if (Path(p) / "entries.csv").exists()]
    if not runs:
        sys.exit("no run folders with entries.csv found")
    pd.set_option("display.width", 200)
    pd.set_option("display.max_columns", 20)
    print(evaluate_runs(runs, bundle).drop(columns=["run"]).to_string(index=False))


if __name__ == "__main__":
    main()
