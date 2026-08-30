"""P(Helpful) and P(Unhelpful) per submitted note, by feed tier and velocity.

Cohort: regular-feed runs only (feed_size in small/large/xl, no misinfo
monitoring context), June 1 onward. Settled = submitted at least 7 days ago.
Velocity = tweets.impressions (frozen at first insert) over age at first sight,
same formula as the pipeline's velocityPerHour.

Outputs data/surfaces.json with, per tier: binned rates and logistic fits for
  conv  = P(note submitted | post processed)
  pH    = P(rated helpful   | note submitted, settled)
  pU    = P(rated unhelpful | note submitted, settled)
so the simulation can score a (tier, velocity) post as conv*pH and conv*pU.
"""

import json
import math
import os
from datetime import datetime, timedelta, timezone

import numpy as np
from sklearn.linear_model import LogisticRegression

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
REGULAR_TIERS = ("small", "large", "xl")
SETTLE_DAYS = 7
VELOCITY_MIN_AGE_HOURS = 0.25
HELPFUL = "CURRENTLY_RATED_HELPFUL"
UNHELPFUL = "CURRENTLY_RATED_NOT_HELPFUL"
VELOCITY_BIN_EDGES = [0, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000, 120_000, float("inf")]


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def load(name):
    return json.load(open(os.path.join(DATA_DIR, name)))


def velocity_at_first_sight(tweet):
    if tweet.get("impressions") is None or not tweet.get("posted_at") or not tweet.get("first_seen_at"):
        return None
    age_h = (parse_ts(tweet["first_seen_at"]) - parse_ts(tweet["posted_at"])).total_seconds() / 3600
    return tweet["impressions"] / max(age_h, VELOCITY_MIN_AGE_HOURS)


def bin_label(v):
    for lo, hi in zip(VELOCITY_BIN_EDGES, VELOCITY_BIN_EDGES[1:]):
        if lo <= v < hi:
            hi_txt = "inf" if hi == float("inf") else f"{hi/1000:g}k"
            return f"{lo/1000:g}k-{hi_txt}"
    return None


def fit_logistic(logvels, outcomes):
    """Return (intercept, coef) of P(outcome) ~ log10(velocity), or None if the
    outcome is all-0/all-1 (no fit possible)."""
    y = np.array(outcomes)
    if len(set(y)) < 2:
        return None
    x = np.array(logvels).reshape(-1, 1)
    model = LogisticRegression(C=1.0)
    model.fit(x, y)
    return [float(model.intercept_[0]), float(model.coef_[0][0])]


def main():
    runs = load("runs.json")
    notes = {n["note_id"]: n for n in load("notes.json")}
    tweets = {t["tweet_id"]: t for t in load("tweets.json")}
    settle_cutoff = datetime.now(timezone.utc) - timedelta(days=SETTLE_DAYS)

    # One record per regular-feed processed post that has a usable velocity.
    records = []
    for r in runs:
        if r["feed_size"] not in REGULAR_TIERS or r["misinfo"] == "yes":
            continue
        v = velocity_at_first_sight(tweets.get(r["tweet_id"], {}))
        if v is None or v <= 0:
            continue
        note = notes.get(r["note_id"]) if r["note_id"] else None
        settled = bool(note and note["submitted_at"] and parse_ts(note["submitted_at"]) < settle_cutoff)
        records.append(
            {
                "tier": r["feed_size"],
                "logvel": math.log10(v),
                "vel": v,
                "submitted": note is not None,
                "settled": settled,
                "helpful": settled and note["cn_status"] == HELPFUL,
                "unhelpful": settled and note["cn_status"] == UNHELPFUL,
                "nmr": settled and note["cn_status"] not in (HELPFUL, UNHELPFUL),
            }
        )

    print(f"regular-feed processed posts with velocity: {len(records)}")
    out = {"bins": {}, "fits": {}}
    for tier in REGULAR_TIERS:
        recs = [r for r in records if r["tier"] == tier]
        submitted = [r for r in recs if r["submitted"]]
        settled = [r for r in recs if r["settled"]]
        n_h = sum(r["helpful"] for r in settled)
        n_u = sum(r["unhelpful"] for r in settled)
        print(
            f"\n{tier}: processed={len(recs)} submitted={len(submitted)} settled={len(settled)} "
            f"H={n_h} ({n_h/max(len(settled),1):.1%}) U={n_u} ({n_u/max(len(settled),1):.1%})"
        )

        rows = []
        for lo, hi in zip(VELOCITY_BIN_EDGES, VELOCITY_BIN_EDGES[1:]):
            in_bin = [r for r in recs if lo <= r["vel"] < hi]
            sub = [r for r in in_bin if r["submitted"]]
            sett = [r for r in in_bin if r["settled"]]
            h = sum(r["helpful"] for r in sett)
            u = sum(r["unhelpful"] for r in sett)
            label = bin_label(lo if lo else 1)
            rows.append(
                {
                    "bin": label,
                    "processed": len(in_bin),
                    "submitted": len(sub),
                    "settled": len(sett),
                    "helpful": h,
                    "unhelpful": u,
                }
            )
            if in_bin:
                conv = len(sub) / len(in_bin)
                ph = h / len(sett) if sett else float("nan")
                pu = u / len(sett) if sett else float("nan")
                print(f"  {label:>10}: proc={len(in_bin):4d} conv={conv:5.1%} settled={len(sett):4d} pH={ph:6.1%} pU={pu:6.1%}")
        out["bins"][tier] = rows

        out["fits"][tier] = {
            "conv": fit_logistic([r["logvel"] for r in recs], [r["submitted"] for r in recs]),
            "pH": fit_logistic([r["logvel"] for r in settled], [r["helpful"] for r in settled]),
            "pU": fit_logistic([r["logvel"] for r in settled], [r["unhelpful"] for r in settled]),
            "n_settled": len(settled),
        }

    json.dump(out, open(os.path.join(DATA_DIR, "surfaces.json"), "w"), indent=1)
    print("\nwrote data/surfaces.json")


if __name__ == "__main__":
    main()
