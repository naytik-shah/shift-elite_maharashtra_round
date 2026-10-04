import os
from pathlib import Path

# risk floor -> weight, highest first (PRD 9.2)
TIERS = [(85, 0.05), (60, 0.20), (30, 0.50), (0, 1.00)]

# a family counts as suspicious at or above this score
FAMILY_THRESHOLD = 0.5

# set TWO_SIGNAL_GUARD=0 to switch the guard off (default on)
GUARD_ENABLED = os.environ.get("TWO_SIGNAL_GUARD", "1") != "0"

BURST_WINDOW_S = 5.0
MAX_LINKED = 50

INSTITUTIONAL_SUFFIXES = tuple(
    s.strip().lower()
    for s in (os.environ.get("INSTITUTIONAL_DOMAINS") or ".edu,.edu.in,.ac.in,.ac.uk").split(",")
    if s.strip()
)

_BUILTIN_DISPOSABLE = {
    "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
    "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com",
}


def load_disposable():
    path = os.environ.get("DISPOSABLE_DOMAINS_PATH")
    domains = set(_BUILTIN_DISPOSABLE)
    if path and Path(path).exists():
        for line in Path(path).read_text().splitlines():
            line = line.strip().lower()
            if line and not line.startswith("#"):
                domains.add(line)
    return frozenset(domains)


MODEL_PATH = os.environ.get("MODEL_PATH", str(Path(__file__).parent / "model" / "model.joblib"))
