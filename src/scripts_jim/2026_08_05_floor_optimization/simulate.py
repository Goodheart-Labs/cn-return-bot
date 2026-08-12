"""Replay the feed ladder over the real supply archive under per-tier velocity
floors, scoring each policy by expected settled outcomes per day.

Supply: feed_tweets arrivals (first sight, frozen impressions + tier) from the
archive, full days only. Selection copies the ladder's semantics: order by tier
rank (small before large before xl) then velocity within a tier, keep posts
clearing their tier's floor, take the daily processing budget. Each selected
post contributes conv*pH expected helpful and conv*pU expected unhelpful notes,
with conv/pH/pU from the logistic fits in surfaces.json.

The budget is the observed regular-feed processing rate over the last 14 days,
so policies compare what the same effort would have yielded.
"""

import itertools
import json
import math
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
REGULAR_TIERS = ("small", "large", "xl")
VELOCITY_MIN_AGE_HOURS = 0.25
FLOOR_GRID = [0, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000, float("inf")]
LAMBDAS = [1, 2, 5, 10]
BUDGET_WINDOW_DAYS = 14


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def load(name):
    return json.load(open(os.path.join(DATA_DIR, name)))


def logistic(fit, logvel):
    return 1 / (1 + math.exp(-(fit[0] + fit[1] * logvel)))


def floor_txt(f):
    return "off" if f == float("inf") else f"{f/1000:g}k"


def main():
    fits = load("surfaces.json")["fits"]

    # Daily processing budget from the recent regular-feed cohort.
    runs = load("runs.json")
    budget_since = datetime.now(timezone.utc) - timedelta(days=BUDGET_WINDOW_DAYS)
    recent = [
        r for r in runs
        if r["feed_size"] in REGULAR_TIERS and r["misinfo"] != "yes" and parse_ts(r["created_at"]) > budget_since
    ]
    budget = round(len(recent) / BUDGET_WINDOW_DAYS)
    print(f"daily processing budget (regular cohort, last {BUDGET_WINDOW_DAYS}d): {budget}")

    # Supply arrivals scored once; grouped by full UTC day.
    today = datetime.now(timezone.utc).date().isoformat()
    by_day = defaultdict(list)
    for s in load("supply.json"):
        day = s["first_seen_at"][:10]
        tier = s["first_seen_feed_size"]
        if day >= today or tier not in REGULAR_TIERS or s["first_seen_impressions"] is None or not s["posted_at"]:
            continue
        age_h = (parse_ts(s["first_seen_at"]) - parse_ts(s["posted_at"])).total_seconds() / 3600
        vel = s["first_seen_impressions"] / max(age_h, VELOCITY_MIN_AGE_HOURS)
        if vel <= 0:
            continue
        logvel = math.log10(vel)
        f = fits[tier]
        conv = logistic(f["conv"], logvel)
        by_day[day].append(
            {
                "tier_rank": REGULAR_TIERS.index(tier),
                "vel": vel,
                "eH": conv * logistic(f["pH"], logvel),
                "eU": conv * logistic(f["pU"], logvel),
            }
        )

    days = sorted(by_day)
    print(f"supply days: {days}")
    for day in days:
        counts = defaultdict(int)
        for p in by_day[day]:
            counts[REGULAR_TIERS[p["tier_rank"]]] += 1
        print(f"  {day}: {dict(counts)}")
    for day in days:
        by_day[day].sort(key=lambda p: (p["tier_rank"], -p["vel"]))

    def evaluate(floors):
        """Mean expected helpful and unhelpful submitted notes per day."""
        total_h = total_u = picked = 0
        for day in days:
            taken = 0
            for p in by_day[day]:
                if taken >= budget:
                    break
                if p["vel"] < floors[p["tier_rank"]]:
                    continue
                taken += 1
                total_h += p["eH"]
                total_u += p["eU"]
            picked += taken
        n = len(days)
        return total_h / n, total_u / n, picked / n

    results = []
    for floors in itertools.product(FLOOR_GRID, repeat=3):
        h, u, picked = evaluate(floors)
        results.append({"floors": floors, "h": h, "u": u, "picked": picked})

    def show(r, tag=""):
        f = r["floors"]
        print(
            f"  small {floor_txt(f[0]):>4} | large {floor_txt(f[1]):>4} | xl {floor_txt(f[2]):>4} "
            f"→ H/day {r['h']:5.2f}  U/day {r['u']:5.2f}  H:U {r['h']/max(r['u'],1e-9):5.1f}  "
            f"picked/day {r['picked']:5.1f} {tag}"
        )

    print("\nbaselines:")
    for f in [(15_000,) * 3, (30_000,) * 3, (0,) * 3]:
        show(next(r for r in results if r["floors"] == f))

    for lam in LAMBDAS:
        best = sorted(results, key=lambda r: r["h"] - lam * r["u"], reverse=True)[:5]
        print(f"\nbest floors for E[H] - {lam}*E[U]:")
        for r in best:
            show(r)

    json.dump(
        [{**r, "floors": [floor_txt(f) for f in r["floors"]]} for r in results],
        open(os.path.join(DATA_DIR, "sim_results.json"), "w"),
    )


if __name__ == "__main__":
    main()
