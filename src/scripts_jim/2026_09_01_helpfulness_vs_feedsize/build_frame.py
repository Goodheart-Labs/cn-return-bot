# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Join runs, notes and tweets into one record per regular-feed processed post,
and print the cohort funnel per tier and floor era.

A record carries the feed tier, the reconstructed velocity at decision time,
the floor era the run happened in, and the note's outcome if one was submitted.
Velocity uses the pipeline's own formula: frozen tweets.impressions over the
age at first sight, clamped to at least 0.25 hours.

Eras (by run date):
  E0 "no floor"  before 2026-07-21 (selection was a soft recency+impressions sort)
  E1 "30k"       2026-07-21 to 2026-07-27
  E2 "15k"       2026-07-28 to 2026-08-23
  E3 "5k"        2026-08-24 onward

Writes data/frame.json and checks the sizing numbers recorded in the plan.
"""

import json
import math
import os
from datetime import datetime, timedelta, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
REGULAR_TIERS = ("small", "large", "xl")
VELOCITY_MIN_AGE_HOURS = 0.25
SETTLE_DAYS = 7
HELPFUL = "CURRENTLY_RATED_HELPFUL"
UNHELPFUL = "CURRENTLY_RATED_NOT_HELPFUL"

ERA_BOUNDS = [
    ("E0 no floor", "2026-07-21"),
    ("E1 30k", "2026-07-28"),
    ("E2 15k", "2026-08-24"),
    ("E3 5k", "9999-12-31"),
]


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def load(name):
    return json.load(open(os.path.join(DATA_DIR, name)))


def era_of(date_str):
    for name, upper in ERA_BOUNDS:
        if date_str < upper:
            return name
    return ERA_BOUNDS[-1][0]


def velocity_at_first_sight(tweet):
    if tweet.get("impressions") is None or not tweet.get("posted_at") or not tweet.get("first_seen_at"):
        return None
    age_h = (parse_ts(tweet["first_seen_at"]) - parse_ts(tweet["posted_at"])).total_seconds() / 3600
    return tweet["impressions"] / max(age_h, VELOCITY_MIN_AGE_HOURS)


def build_frame():
    runs = load("runs.json")
    notes = {n["note_id"]: n for n in load("notes.json")}
    tweets = {t["tweet_id"]: t for t in load("tweets.json")}
    now = datetime.now(timezone.utc)

    frame = []
    for r in runs:
        if r["feed_size"] not in REGULAR_TIERS or r["misinfo"] == "yes":
            continue
        v = velocity_at_first_sight(tweets.get(r["tweet_id"], {}))
        if v is None or v <= 0:
            continue
        note = notes.get(r["note_id"]) if r["note_id"] else None
        submitted = bool(note and note["submitted_at"])
        days_since_submission = (
            (now - parse_ts(note["submitted_at"])).total_seconds() / 86400 if submitted else None
        )
        frame.append(
            {
                "tier": r["feed_size"],
                "vel": v,
                "logvel": math.log10(v),
                "era": era_of(r["created_at"][:10]),
                "submitted": submitted,
                "status": note["cn_status"] if submitted else None,
                "days_since_submission": days_since_submission,
            }
        )
    return frame


def print_funnel(frame):
    print(f"{'era':<13}{'tier':<7}{'processed':>10}{'submitted':>10}{'settled7':>9}{'H':>5}{'U':>5}{'sub-5k sub':>11}")
    eras = [e for e, _ in ERA_BOUNDS]
    for era in eras:
        for tier in REGULAR_TIERS:
            recs = [r for r in frame if r["era"] == era and r["tier"] == tier]
            sub = [r for r in recs if r["submitted"]]
            eligible = [r for r in sub if r["days_since_submission"] >= SETTLE_DAYS]
            h = sum(r["status"] == HELPFUL for r in eligible)
            u = sum(r["status"] == UNHELPFUL for r in eligible)
            settled = sum(r["status"] in (HELPFUL, UNHELPFUL) for r in eligible)
            slow = sum(r["vel"] < 5_000 for r in sub)
            print(f"{era:<13}{tier:<7}{len(recs):>10}{len(sub):>10}{settled:>9}{h:>5}{u:>5}{slow:>11}")


def check_plan_numbers(frame):
    """The plan's Verification section pins the sizing numbers this data must
    reproduce (allowing a few days of drift since they were measured)."""
    sub = [r for r in frame if r["submitted"]]
    settled = [r for r in sub if r["status"] in (HELPFUL, UNHELPFUL)]
    by_tier = {t: sum(r["tier"] == t for r in settled) for t in REGULAR_TIERS}
    print(f"\nsettled submitted notes: {len(settled)} (plan: ~655)")
    print(f"tier split: small {by_tier['small']} / large {by_tier['large']} / xl {by_tier['xl']} (plan: 211/329/115)")
    e0_slow = {
        t: sum(r["tier"] == t and r["era"] == "E0 no floor" and r["vel"] < 5_000 for r in sub)
        for t in REGULAR_TIERS
    }
    print(f"pre-floor sub-5k submitted: large {e0_slow['large']} / small {e0_slow['small']} / xl {e0_slow['xl']} (plan: 427/158/9)")


def main():
    frame = build_frame()
    print(f"regular-feed processed posts with velocity: {len(frame)}\n")
    print_funnel(frame)
    check_plan_numbers(frame)
    json.dump(frame, open(os.path.join(DATA_DIR, "frame.json"), "w"))
    print("\nwrote data/frame.json")


if __name__ == "__main__":
    main()
