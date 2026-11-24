"""Where the difference between today's order and +1 per reader of the last 24 hours comes from:
per day, per post, and how large creator ranks and reader counts are.

Run from the repository root: uv run src/scripts_jim/2026_11_24_reader_count_ranking/details.py
"""

import collections
import json
import statistics
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from replay import DATA, ORDERS, CreatorRanks, load_posts, parse_time, replay  # noqa: E402

START = datetime(2026, 11, 19, 8, tzinfo=timezone.utc)
END = datetime(2026, 11, 23, tzinfo=timezone.utc)
HORIZON = timedelta(hours=24)
NAMES = ("today", "today + #772", "+1 per reader of the last 24 h")


def quantiles(values, qs=(0.1, 0.25, 0.5, 0.75, 0.9, 0.99)):
    values = sorted(values)
    return {q: round(values[min(len(values) - 1, int(q * len(values)))], 2) for q in qs}


def main():
    posts = load_posts()
    slots = sorted(json.load(open(DATA / "slots.json")), key=lambda s: s["started_at"])
    ranks = CreatorRanks(json.load(open(DATA / "creator_scores.json")), json.load(open(DATA / "projects.json")))
    orders = {o.name: o for o in ORDERS}
    for window_days in (1, 14):
        print(f"\n===== list window {window_days} day(s), 24 h horizon =====")
        runs = {name: replay(orders[name], posts, slots, ranks, START, END, window_days, HORIZON) for name in NAMES}
        print("later readers per UTC day of the check:")
        for name, checks in runs.items():
            per_day = collections.Counter()
            for c in checks:
                per_day[c.at.date().isoformat()] += c.later_readers
            print(f"  {name:16}", dict(sorted(per_day.items())))
        base = {c.post.id: c for c in runs["today"]}
        new = {c.post.id: c for c in runs["+1 per reader of the last 24 h"]}
        gained = sorted((new[i] for i in new.keys() - base.keys()), key=lambda c: -c.later_readers)
        lost = sorted((base[i] for i in base.keys() - new.keys()), key=lambda c: -c.later_readers)
        print(f"posts only the recent-reader order checked: {len(gained)}, later readers {sum(c.later_readers for c in gained)}")
        for c in gained[:8]:
            print(f"   +{c.later_readers:3}  had {c.readers_before} readers, {c.post.kind}, {c.post.creator}  {c.post.page[:80]}")
        print(f"posts only today's order checked: {len(lost)}, later readers {sum(c.later_readers for c in lost)}")
        for c in lost[:8]:
            print(f"   -{c.later_readers:3}  had {c.readers_before} readers, {c.post.kind}, {c.post.creator}  {c.post.page[:80]}")
        both = base.keys() & new.keys()
        print(f"posts both checked: {len(both)}; later readers today {sum(base[i].later_readers for i in both)}, "
              f"recent-reader order {sum(new[i].later_readers for i in both)} (the same posts, checked at other times)")

    print("\n===== scale: creator rank and readers of the posts on the list =====")
    sample_times = [START + timedelta(hours=h) for h in range(0, int((END - START).total_seconds() // 3600), 6)]
    creator_ranks, reader_counts = [], []
    for at in sample_times:
        for p in posts:
            if p.added_at <= at and p.list_day >= at.date() - timedelta(days=1) and (p.checked_before is None or p.checked_before > at):
                r = ranks.rank(p.creator, at)
                if r < 1000:
                    creator_ranks.append(r)
                reader_counts.append(p.readers_before(at))
    print(f"posts on the 1-day list, sampled every 6 hours: {len(reader_counts)} post-moments")
    print("  creator rank (priority creators left out) quantiles:", quantiles(creator_ranks))
    print("  readers so far quantiles:", quantiles(reader_counts))
    print("  share with at least one reader:", round(sum(1 for r in reader_counts if r > 0) / len(reader_counts), 3))
    print("  mean creator rank", round(statistics.mean(creator_ranks), 2), " mean readers so far", round(statistics.mean(reader_counts), 2))


if __name__ == "__main__":
    main()
