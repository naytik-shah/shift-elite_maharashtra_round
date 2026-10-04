import re

import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

import config

_TRAIL = re.compile(r"(\d+)$")

# columns fed to the model, in order (see to_matrix)
FEATURE_COLUMNS = [
    "fp_count", "fp_subnets", "fp_spread",
    "subnet_count", "subnet_ratio", "ip_count",
    "burst5", "gap_min", "gap_cv", "pow_ratio", "pow_low",
    "stem_size", "seq_adjacent", "near_dupes", "min_edit", "trail_len", "disposable",
    "cluster_size",
    "device_score", "ip_score", "timing_score", "email_score",
]
_LOG_COLUMNS = {
    "fp_count", "fp_subnets", "subnet_count", "subnet_ratio", "ip_count",
    "burst5", "stem_size", "seq_adjacent", "cluster_size",
}


def subnet_of(ip):
    ip = str(ip)
    if ":" in ip:
        parts = ip.split(":")
        return ":".join(parts[:4])
    return ".".join(ip.split(".")[:3])


def _lev(a, b):
    if a == b:
        return 0
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _groups(gid, min_size=3):
    """Yield index arrays for groups of at least min_size (gid < 0 means no group)."""
    order = np.argsort(gid, kind="stable")
    gs = gid[order]
    bounds = np.flatnonzero(np.diff(gs)) + 1
    for s, e in zip(np.r_[0, bounds], np.r_[bounds, len(gs)]):
        if gs[s] >= 0 and e - s >= min_size:
            yield order[s:e]


def _gap_stats(gid, t, window):
    n = len(gid)
    burst = np.zeros(n)
    min_gap = np.full(n, np.inf)
    cv = np.full(n, np.nan)
    size = np.zeros(n)
    for idx in _groups(gid):
        o = np.argsort(t[idx])
        idx = idx[o]
        tt = t[idx]
        lo = np.searchsorted(tt, tt - window, "left")
        hi = np.searchsorted(tt, tt + window, "right")
        burst[idx] = hi - lo - 1
        gaps = np.diff(tt)
        min_gap[idx] = np.minimum(np.r_[np.inf, gaps], np.r_[gaps, np.inf])
        mean = gaps.mean()
        cv[idx] = gaps.std() / mean if mean > 0 else 0.0
        size[idx] = len(idx)
    return burst, min_gap, cv, size


def _ngroup(keys, eligible):
    """Group ids for eligible rows, -1 for the rest."""
    gid = np.full(len(keys), -1, dtype=np.int64)
    if eligible.any():
        gid[eligible] = pd.factorize(keys[eligible])[0]
    return gid


def build_features(df):
    """df columns: id, device_fp, ip, pow_server_ms, created_at, email (one row per entry)."""
    d = df.reset_index(drop=True).copy()
    n = len(d)
    if n == 0:
        return pd.DataFrame(columns=["id"] + FEATURE_COLUMNS)

    d["id"] = d["id"].astype(str)
    d["ip"] = d["ip"].fillna("0.0.0.0").astype(str)
    d["subnet"] = d["ip"].map(subnet_of)
    fp = d["device_fp"].fillna("").astype(str)
    d["fp"] = np.where(fp == "", "none-" + d["id"], fp)

    ts = pd.to_datetime(d["created_at"], utc=True)
    t = (ts - ts.min()).dt.total_seconds().to_numpy()

    # device
    fp_count = d.groupby("fp")["id"].transform("size").to_numpy().astype(float)
    fp_subnets = d.groupby("fp")["subnet"].transform("nunique").to_numpy().astype(float)
    fp_spread = np.where(fp_count > 1, (fp_subnets - 1) / np.maximum(fp_count - 1, 1), 1.0)
    device_score = np.clip(np.log2(fp_count) / np.log2(20), 0, 1) * (1 - fp_spread)

    # ip and subnet
    subnet_count = d.groupby("subnet")["id"].transform("size").to_numpy().astype(float)
    ip_count = d.groupby("ip")["id"].transform("size").to_numpy().astype(float)
    median_subnet = max(1.0, float(d.groupby("subnet").size().median()))
    subnet_ratio = subnet_count / median_subnet
    ip_score = np.clip(0.7 * np.log10(subnet_ratio) / 2 + 0.3 * np.log10(ip_count), 0, 1)

    # email parts
    em = d["email"].fillna("").astype(str).str.lower()
    parts = em.str.rsplit("@", n=1)
    local = parts.str[0].fillna("")
    domain = parts.str[1].fillna("")
    trail = local.str.extract(_TRAIL)[0]
    trail_len = trail.str.len().fillna(0).to_numpy().astype(float)
    num = pd.to_numeric(trail, errors="coerce").to_numpy()
    stem = local.str.replace(r"\d+$", "", regex=True)
    stem_key = (stem + "@" + domain).to_numpy()
    stem_ok = (trail_len > 0) & (stem.str.len().to_numpy() >= 3)
    stem_gid0 = _ngroup(stem_key, stem_ok)
    stem_size = np.ones(n)
    for idx in _groups(stem_gid0, 1):
        stem_size[idx] = len(idx)
    stem_gid = np.where(stem_size >= 3, stem_gid0, -1)

    institutional = domain.map(lambda x: x.endswith(config.INSTITUTIONAL_SUFFIXES)).to_numpy()
    disposable = domain.isin(config.load_disposable()).to_numpy().astype(float)

    # numbered series, e.g. acct00001, acct00002
    seq_adjacent = np.zeros(n)
    for idx in _groups(stem_gid):
        vals = np.sort(num[idx])
        v = num[idx]
        seq_adjacent[idx] = np.searchsorted(vals, v + 5, "right") - np.searchsorted(vals, v - 5, "left") - 1
    seq_score = np.clip(seq_adjacent / 6, 0, 1) * (~institutional)

    # near duplicates, compared with the next entry in sorted order
    order = np.argsort((domain + "|" + local).to_numpy(), kind="stable")
    sl = local.to_numpy()[order]
    sd = domain.to_numpy()[order]
    nd = np.ones(max(n - 1, 0))
    for i in range(n - 1):
        if sd[i] == sd[i + 1]:
            nd[i] = _lev(sl[i], sl[i + 1]) / max(len(sl[i]), len(sl[i + 1]), 1)
    left = np.r_[1.0, nd]
    right = np.r_[nd, 1.0]
    min_edit = np.empty(n)
    near = np.empty(n)
    min_edit[order] = np.minimum(left, right)
    near[order] = (left <= 0.15).astype(float) + (right <= 0.15).astype(float)
    near_score = np.clip(near / 2, 0, 1) * 0.6

    email_score = np.maximum.reduce([seq_score, near_score, 0.9 * disposable])

    # timing: bursts and regular gaps inside subnet, device and email-series groups
    subnet_gid = _ngroup(d["subnet"].to_numpy(), np.ones(n, dtype=bool))
    fp_gid = _ngroup(d["fp"].to_numpy(), np.ones(n, dtype=bool))
    res = [_gap_stats(g, t, config.BURST_WINDOW_S) for g in (subnet_gid, fp_gid, stem_gid)]
    burst5 = np.max([r[0] for r in res], axis=0)
    gap_min = np.minimum(np.min([r[1] for r in res], axis=0), 3600.0)
    sizes = np.stack([r[3] for r in res])
    cvs = np.stack([r[2] for r in res])
    gap_cv = cvs[sizes.argmax(axis=0), np.arange(n)]
    gap_size = sizes.max(axis=0)
    gap_cv = np.where(np.isnan(gap_cv), 1.0, gap_cv)

    pow_ms = pd.to_numeric(d["pow_server_ms"], errors="coerce").to_numpy()
    pow_med = np.nanmedian(pow_ms) if np.isfinite(pow_ms).any() else 0.0
    pow_ratio = np.where(np.isfinite(pow_ms) & (pow_med > 0), pow_ms / max(pow_med, 1e-9), 1.0)
    pow_low = ((pow_ratio < 0.1) & (pow_med >= 20)).astype(float)

    burst_score = np.clip(np.log2(1 + burst5) / np.log2(31), 0, 1)
    regular_score = np.where(gap_size >= 5, np.clip((1 - gap_cv) / 0.7, 0, 1), 0.0)
    timing_score = np.clip(0.5 * burst_score + 0.3 * regular_score + 0.2 * pow_low, 0, 1)

    # clusters: entries that share at least two different signals
    cluster_label, cluster_size = _clusters(
        [
            _ngroup(d["fp"].to_numpy(), fp_count >= 2),
            _ngroup(d["subnet"].to_numpy(), subnet_count >= 2),
            _ngroup(d["ip"].to_numpy(), ip_count >= 2),
            stem_gid,
        ]
    )

    out = pd.DataFrame(
        {
            "id": d["id"],
            "fp_count": fp_count, "fp_subnets": fp_subnets, "fp_spread": fp_spread,
            "subnet_count": subnet_count, "subnet_ratio": subnet_ratio, "ip_count": ip_count,
            "burst5": burst5, "gap_min": gap_min, "gap_cv": gap_cv,
            "pow_ratio": np.clip(pow_ratio, 0, 10), "pow_low": pow_low,
            "stem_size": stem_size, "seq_adjacent": seq_adjacent, "near_dupes": near,
            "min_edit": min_edit, "trail_len": trail_len, "disposable": disposable,
            "cluster_size": cluster_size,
            "device_score": device_score, "ip_score": ip_score,
            "timing_score": timing_score, "email_score": email_score,
            "cluster_label": cluster_label,
            "stem": stem.to_numpy(),
        }
    )
    return out


def _clusters(gids):
    """gids order: fp, subnet, ip, stem. Link entries that match on two or more of them."""
    n = len(gids[0])
    fp, subnet, ip, stem = gids
    pairs = [(fp, subnet), (fp, ip), (fp, stem), (subnet, stem), (ip, stem)]
    rows, cols = [], []
    for a, b in pairs:
        m = (a >= 0) & (b >= 0)
        if not m.any():
            continue
        idx = np.flatnonzero(m)
        key = a[m] * (int(b.max()) + 1) + b[m]
        _, first_pos, inv = np.unique(key, return_index=True, return_inverse=True)
        first = idx[first_pos][inv]
        keep = idx != first
        rows.append(idx[keep])
        cols.append(first[keep])
    if rows:
        r, c = np.concatenate(rows), np.concatenate(cols)
    else:
        r = c = np.array([], dtype=np.int64)
    graph = coo_matrix((np.ones(len(r)), (r, c)), shape=(n, n))
    _, labels = connected_components(graph, directed=False)
    sizes = np.bincount(labels)[labels].astype(float)
    return labels, sizes


def to_matrix(feat):
    cols = []
    for c in FEATURE_COLUMNS:
        v = feat[c].to_numpy(dtype=float)
        if c in _LOG_COLUMNS:
            v = np.log1p(v)
        elif c == "gap_min":
            v = np.log1p(np.minimum(v, 3600.0))
        cols.append(v)
    return np.column_stack(cols)
