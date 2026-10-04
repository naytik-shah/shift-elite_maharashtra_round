import numpy as np
import pandas as pd

import config
from features import build_features, to_matrix

FAMILIES = ["device", "ip", "timing", "email"]


def weight_for(risk):
    for floor, w in config.TIERS:
        if risk >= floor:
            return w
    return 1.0


def prob_to_risk(proba, cutoffs=None):
    """Probability to risk 0-100. With cut-offs (honest 99th, 99.7th and 99.9th percentile probability) the
    map is piecewise linear through 0 -> 0, cut-offs -> 30, 60, 85 and 1 -> 100. Without them it is 100 x p,
    so model files saved before the cut-offs existed behave as before."""
    proba = np.asarray(proba, dtype=float)
    if not cutoffs:
        return np.clip(np.round(100 * proba), 0, 100)
    xs = np.concatenate([[0.0], np.asarray(cutoffs, dtype=float), [1.0]])
    for i in range(1, len(xs)):  # keep the points strictly increasing if two percentiles tie
        xs[i] = max(xs[i], np.nextafter(xs[i - 1], 1.0))
    return np.round(np.interp(proba, xs, [0, *config.CUTOFF_RISKS, 100]))


def fallback_risk(feat):
    """Fixed rule from PRD 9.2, used when no trained model is available."""
    base = 100 * (
        0.35 * feat["device_score"] + 0.25 * feat["ip_score"]
        + 0.20 * feat["timing_score"] + 0.20 * feat["email_score"]
    )
    size = feat["cluster_size"].to_numpy()
    bonus = np.where(size >= 3, np.clip(6 * np.log2(np.maximum(size, 1)), 0, 30), 0.0)
    return np.clip(base.to_numpy() + bonus, 0, 100)


def _reasons(row, guarded):
    out = []
    thr = config.FAMILY_THRESHOLD
    if row.device_score >= thr:
        out.append(f"{int(row.fp_count)} entries share this device fingerprint, spread over only {int(row.fp_subnets)} network(s)")
    if row.ip_score >= thr:
        out.append(f"{int(row.subnet_count)} entries come from the same /24 network, about {row.subnet_ratio:.0f}x the typical network")
    if row.timing_score >= thr:
        if row.burst5 >= 5:
            out.append(f"{int(row.burst5)} related entries arrived within {config.BURST_WINDOW_S:.0f} seconds of this one")
        elif row.gap_cv < 0.5:
            out.append("related entries arrived at very regular intervals")
        if row.pow_low:
            out.append("the puzzle was solved much faster than normal")
    if row.email_score >= thr:
        if row.disposable:
            out.append("the email uses a disposable domain")
        elif row.seq_adjacent >= 3:
            out.append(f"email follows a numbered series ('{row.stem}' plus a number) shared by {int(row.stem_size)} entries")
        else:
            out.append("email is almost identical to neighbouring entries")
    if row.cluster_size >= 5:
        out.append(f"linked to {int(row.cluster_size) - 1} other entries through shared signals")
    if guarded:
        out.append("only one kind of signal looked odd, so the weight was kept at 1.0")
    return out[:6]


def score_features(feat, bundle=None, guard=None, with_reasons=True):
    guard = config.GUARD_ENABLED if guard is None else guard
    n = len(feat)
    if n == 0:
        return pd.DataFrame(columns=["id", "risk", "weight"])

    if bundle is not None:
        proba = bundle["model"].predict_proba(to_matrix(feat))[:, 1]
        raw = prob_to_risk(proba, bundle.get("cutoffs"))
    else:
        raw = np.round(fallback_risk(feat))

    fam = np.column_stack([feat[f"{f}_score"].to_numpy() for f in FAMILIES])
    suspicious = (fam >= config.FAMILY_THRESHOLD).sum(axis=1)
    guarded = (suspicious < 2) & (raw >= 30) if guard else np.zeros(n, dtype=bool)
    risk = np.where((suspicious < 2) & guard, np.minimum(raw, 29), raw).astype(int)
    weight = np.array([weight_for(r) for r in risk])

    cl = feat["cluster_size"].to_numpy()
    cluster_id = np.where(cl >= 2, "c" + feat["cluster_label"].astype(str).to_numpy(), None)

    res = pd.DataFrame(
        {
            "id": feat["id"].to_numpy(),
            "risk": risk,
            "weight": weight,
            "raw_risk": raw.astype(int),
            "device": feat["device_score"].round(3).to_numpy(),
            "ip": feat["ip_score"].round(3).to_numpy(),
            "timing": feat["timing_score"].round(3).to_numpy(),
            "email": feat["email_score"].round(3).to_numpy(),
            "cluster_id": cluster_id,
            "cluster_size": cl.astype(int),
        }
    )

    if with_reasons:
        reasons = [[] for _ in range(n)]
        linked = [[] for _ in range(n)]
        members = {}
        for i, (lab, size) in enumerate(zip(feat["cluster_label"].to_numpy(), cl)):
            if size >= 2:
                members.setdefault(lab, []).append(i)
        ids = feat["id"].to_numpy()
        for lab, idx in members.items():
            shown = [ids[j] for j in idx[: config.MAX_LINKED + 1]]
            for i in idx:
                linked[i] = [x for x in shown if x != ids[i]][: config.MAX_LINKED]
        for i in np.flatnonzero((risk >= 30) | guarded):
            reasons[i] = _reasons(feat.iloc[i], bool(guarded[i]))
        res["reasons"] = reasons
        res["linked"] = linked
    return res


def score_entries(df, bundle=None, guard=None, with_reasons=True):
    return score_features(build_features(df), bundle, guard, with_reasons)
