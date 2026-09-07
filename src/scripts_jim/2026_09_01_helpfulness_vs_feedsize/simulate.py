# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
"""Replay the feed ladder over the real supply archive under per-tier velocity
floors, scoring each policy by expected helpful minus unhelpful notes per day.

Upgrades over 2026_08_05_floor_optimization/simulate.py:
  * Per-run replay. Supply arrivals are grouped into their 15-minute archive
    batches. Each batch gets its share of the daily processing budget, and a
    post not picked in its arrival batch stays available for the rest of that
    day, which mirrors how the real feed keeps re-surfacing unpicked posts.
    The old per-day pooling let a policy cherry-pick the whole day at once.
  * Three-plus weeks of supply instead of four days.
  * A day-level block bootstrap, so every policy gets a confidence interval.

The floor grid is asymmetric on purpose. Small and large search down to zero
because the pre-floor era observed outcomes at those velocities. xl starts at
5k because no era ever selected slow xl posts, so scores below that would be
pure extrapolation.

Run with --aug5 for the reproduction check against the Aug 5 results: per-day
pooling, only the four supply days that analysis had, and its 670/day budget.
"""

import itertools
import json
import math
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import numpy as np

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
REGULAR_TIERS = ("small", "large", "xl")
VELOCITY_MIN_AGE_HOURS = 0.25
SMALL_LARGE_GRID = [0, 1_000, 2_000, 5_000, 8_000, 15_000, 30_000, float("inf")]
XL_GRID = [5_000, 8_000, 15_000, 30_000, float("inf")]
GLOBAL_CANDIDATES = [5_000, 8_000, 15_000, 30_000]
CURRENT_POLICY = (5_000, 5_000, 5_000)
BUDGET_WINDOW_DAYS = 14
BOOTSTRAP_REPS = 1_000
BOOTSTRAP_SEED = 7
AUG5_LAST_SUPPLY_DAY = "2026-08-11"
AUG5_BUDGET_PER_DAY = 670


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def load(name):
    return json.load(open(os.path.join(DATA_DIR, name)))


def logistic(fit, logvel):
    return 1 / (1 + math.exp(-(fit[0] + fit[1] * logvel)))


def floor_txt(f):
    return "off" if f == 0 else ("∞" if f == float("inf") else f"{f/1000:g}k")


def policy_txt(floors):
    return f"small {floor_txt(floors[0]):>4} | large {floor_txt(floors[1]):>4} | xl {floor_txt(floors[2]):>4}"


def daily_budget(runs):
    since = datetime.now(timezone.utc) - timedelta(days=BUDGET_WINDOW_DAYS)
    recent = [
        r for r in runs
        if r["feed_size"] in REGULAR_TIERS and r["misinfo"] != "yes" and parse_ts(r["created_at"]) > since
    ]
    return round(len(recent) / BUDGET_WINDOW_DAYS)


def scored_supply(fits, last_day=None):
    """Supply arrivals scored with the outcome surfaces, grouped by day and
    within a day by their 15-minute archive batch, chronologically."""
    today = datetime.now(timezone.utc).date().isoformat()
    by_day_batch = defaultdict(lambda: defaultdict(list))
    for s in load("supply.json"):
        day = s["first_seen_at"][:10]
        tier = s["first_seen_feed_size"]
        if day >= today or (last_day and day > last_day):
            continue
        if tier not in REGULAR_TIERS or s["first_seen_impressions"] is None or not s["posted_at"]:
            continue
        age_h = (parse_ts(s["first_seen_at"]) - parse_ts(s["posted_at"])).total_seconds() / 3600
        vel = s["first_seen_impressions"] / max(age_h, VELOCITY_MIN_AGE_HOURS)
        if vel <= 0:
            continue
        logvel = math.log10(vel)
        f = fits[tier]
        conv = logistic(f["conv"], logvel)
        by_day_batch[day][s["first_seen_at"][:16]].append(
            {
                "tier_rank": REGULAR_TIERS.index(tier),
                "vel": vel,
                "eH": conv * logistic(f["pH"], logvel),
                "eU": conv * logistic(f["pU"], logvel),
            }
        )
    days = sorted(by_day_batch)
    return days, {
        day: [sorted(by_day_batch[day][b], key=lambda p: (p["tier_rank"], -p["vel"])) for b in sorted(by_day_batch[day])]
        for day in days
    }


def batch_budgets(total, n_batches):
    """Spread the daily budget over the day's batches, remainder first."""
    base, rem = divmod(total, n_batches)
    return [base + (1 if i < rem else 0) for i in range(n_batches)]


def replay_day(batches, floors, budget):
    """One day under one policy: walk batches chronologically, keep unpicked
    above-floor posts available for later batches the same day."""
    ladder_key = lambda p: (p["tier_rank"], -p["vel"])
    leftovers = []
    day_h = day_u = 0.0
    for batch, k in zip(batches, batch_budgets(budget, len(batches))):
        eligible = [p for p in batch if p["vel"] >= floors[p["tier_rank"]]]
        pool = sorted(leftovers + eligible, key=ladder_key)
        for p in pool[:k]:
            day_h += p["eH"]
            day_u += p["eU"]
        leftovers = pool[k:]
    return day_h, day_u


def evaluate_policies(policies, days, supply, budget, pooled_per_day=False):
    """Per-policy arrays of per-day expected helpful and unhelpful counts."""
    results = {}
    for floors in policies:
        h = np.empty(len(days))
        u = np.empty(len(days))
        for i, day in enumerate(days):
            batches = [sum(supply[day], [])] if pooled_per_day else supply[day]
            h[i], u[i] = replay_day(batches, floors, budget)
        results[floors] = (h, u)
    return results


def bootstrap_ci(values_per_day, rng_indices):
    """95% interval of the per-day mean under day resampling."""
    means = values_per_day[rng_indices].mean(axis=1)
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def main():
    aug5_mode = "--aug5" in sys.argv
    fits = load("surfaces.json")["fits"]
    runs = load("runs.json")
    budget = AUG5_BUDGET_PER_DAY if aug5_mode else daily_budget(runs)
    days, supply = scored_supply(fits, last_day=AUG5_LAST_SUPPLY_DAY if aug5_mode else None)
    print(f"supply days: {len(days)} ({days[0]} to {days[-1]}), daily budget: {budget}")

    if aug5_mode:
        print("\nAug 5 reproduction check (per-day pooling, their supply window and budget):")
        results = evaluate_policies([(15_000,) * 3, (0, 0, 0)], days, supply, budget, pooled_per_day=True)
        for floors, label, aug5 in [
            ((15_000,) * 3, "15k global", "Aug 5: H/day 5.96, U/day 2.42"),
            ((0, 0, 0), "no floor", "Aug 5: H/day 6.46, U/day 1.65"),
        ]:
            h, u = results[floors]
            print(f"  {label:<11} H/day {h.mean():5.2f}  U/day {u.mean():5.2f}   ({aug5})")
        return

    policies = list(itertools.product(SMALL_LARGE_GRID, SMALL_LARGE_GRID, XL_GRID))
    results = evaluate_policies(policies, days, supply, budget)

    rng = np.random.default_rng(BOOTSTRAP_SEED)
    idx = rng.integers(0, len(days), size=(BOOTSTRAP_REPS, len(days)))

    def objective(floors):
        h, u = results[floors]
        return (h - u).mean()

    def report(floors, tag=""):
        h, u = results[floors]
        lo, hi = bootstrap_ci(h - u, idx)
        print(
            f"  {policy_txt(floors)} → H/day {h.mean():5.2f}  U/day {u.mean():5.2f}  "
            f"H-U {objective(floors):5.2f} [{lo:.2f}, {hi:.2f}] {tag}"
        )

    best = max(policies, key=objective)
    best_global = max([(f, f, f) for f in GLOBAL_CANDIDATES], key=objective)

    print("\ntop 5 per-tier policies by expected helpful minus unhelpful notes per day:")
    for floors in sorted(policies, key=objective, reverse=True)[:5]:
        report(floors)
    print("\nbaselines:")
    report(CURRENT_POLICY, "(current production floor)")
    report(best_global, "(best identified global floor)")

    for name, a, b in [
        ("best per-tier minus current 5k global", best, CURRENT_POLICY),
        ("best per-tier minus best global", best, best_global),
    ]:
        diff = (results[a][0] - results[a][1]) - (results[b][0] - results[b][1])
        lo, hi = bootstrap_ci(diff, idx)
        print(f"\n{name}: {diff.mean():+.2f} H-U/day [{lo:+.2f}, {hi:+.2f}]")

    json.dump(
        [
            {
                "floors": [floor_txt(f) for f in floors],
                "h_per_day": float(results[floors][0].mean()),
                "u_per_day": float(results[floors][1].mean()),
            }
            for floors in policies
        ],
        open(os.path.join(DATA_DIR, "sim_results.json"), "w"),
    )
    print("\nwrote data/sim_results.json (full grid)")


if __name__ == "__main__":
    main()
