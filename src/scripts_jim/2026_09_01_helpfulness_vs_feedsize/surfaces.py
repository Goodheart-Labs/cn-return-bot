# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scikit-learn"]
# ///
"""Per-tier outcome surfaces for the floor simulation, with era adjustment.

For each tier, three logistic fits on log10(velocity) with era dummies:
  conv = P(note submitted   | post processed)
  pH   = P(settled helpful  | note submitted, old enough to settle)
  pU   = P(settled unhelpful| note submitted, old enough to settle)

The era dummies absorb level shifts between the pre-floor era, the pooled
30k/15k era, and the current 5k era, so the velocity slope is learned from all
eras (the sub-5k range only exists pre-floor) while the saved intercept is the
prediction at the current era. The simulation then scores a (tier, velocity)
post as conv*pH expected helpful and conv*pU expected unhelpful notes.

Writes data/surfaces.json in the same {fits: {tier: {conv,pH,pU}}} shape the
2026_08_05_floor_optimization simulator used. Also prints the per-tier settled
rates next to the Aug 5 numbers as a drift check.
"""

import json
import os

import numpy as np
from sklearn.linear_model import LogisticRegression

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
REGULAR_TIERS = ("small", "large", "xl")
SETTLE_DAYS = 7
HELPFUL = "CURRENTLY_RATED_HELPFUL"
UNHELPFUL = "CURRENTLY_RATED_NOT_HELPFUL"
ERA3 = {"E0 no floor": "pre-floor", "E1 30k": "high floor", "E2 15k": "high floor", "E3 5k": "5k floor"}
# Aug 5 settled shares per tier (H%, U%) from 2026_08_05_floor_optimization/RESULTS.md.
AUG5_SETTLED_RATES = {"small": (12.7, 2.7), "large": (10.1, 2.9), "xl": (9.7, 5.2)}


def load_frame():
    frame = json.load(open(os.path.join(DATA_DIR, "frame.json")))
    for r in frame:
        r["era3"] = ERA3[r["era"]]
        r["eligible"] = bool(r["submitted"] and r["days_since_submission"] >= SETTLE_DAYS)
        r["helpful"] = r["status"] == HELPFUL
        r["unhelpful"] = r["status"] == UNHELPFUL
    return frame


def era_features(records):
    """Design matrix [logvel, is_pre_floor, is_high_floor]; the current era is
    the reference, so predicting with zeroed dummies predicts at the 5k era."""
    return np.array(
        [[r["logvel"], r["era3"] == "pre-floor", r["era3"] == "high floor"] for r in records], dtype=float
    )


def fit_at_current_era(records, outcomes):
    """Return [intercept, logvel_coef] predicted at the current era, or None if
    the outcome does not vary."""
    y = np.array(outcomes, dtype=int)
    if len(set(y)) < 2:
        return None
    model = LogisticRegression(C=1.0)
    model.fit(era_features(records), y)
    return [float(model.intercept_[0]), float(model.coef_[0][0])]


def main():
    frame = load_frame()
    out = {"fits": {}}
    print(f"{'tier':<7}{'processed':>10}{'submitted':>10}{'eligible':>9}{'H%':>7}{'U%':>7}{'Aug5 H%/U%':>12}")
    for tier in REGULAR_TIERS:
        recs = [r for r in frame if r["tier"] == tier]
        submitted = [r for r in recs if r["submitted"]]
        eligible = [r for r in recs if r["eligible"]]
        n_h = sum(r["helpful"] for r in eligible)
        n_u = sum(r["unhelpful"] for r in eligible)
        aug5 = AUG5_SETTLED_RATES[tier]
        print(
            f"{tier:<7}{len(recs):>10}{len(submitted):>10}{len(eligible):>9}"
            f"{100 * n_h / max(len(eligible), 1):>6.1f}%{100 * n_u / max(len(eligible), 1):>6.1f}%"
            f"{aug5[0]:>8.1f}/{aug5[1]:.1f}"
        )
        out["fits"][tier] = {
            "conv": fit_at_current_era(recs, [r["submitted"] for r in recs]),
            "pH": fit_at_current_era(eligible, [r["helpful"] for r in eligible]),
            "pU": fit_at_current_era(eligible, [r["unhelpful"] for r in eligible]),
            "n_eligible": len(eligible),
        }

    json.dump(out, open(os.path.join(DATA_DIR, "surfaces.json"), "w"), indent=1)
    print("\nwrote data/surfaces.json (fits predicted at the 5k era)")


if __name__ == "__main__":
    main()
