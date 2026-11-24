"""Replays the order that went live with a reader worth 0.7 instead of 1.

Run from the repository root: uv run src/scripts_jim/2026_11_24_reader_count_ranking/weight_07.py
"""

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from replay import DATA, ORDERS, CreatorRanks, Order, load_posts, recent_readers, replay, summarize  # noqa: E402

START = datetime(2026, 11, 19, 8, tzinfo=timezone.utc)
END = datetime(2026, 11, 23, tzinfo=timezone.utc)
HORIZON = timedelta(hours=24)
DAYS = (END - START).total_seconds() / 86400

posts = load_posts()
slots = sorted(json.load(open(DATA / "slots.json")), key=lambda s: s["started_at"])
ranks = CreatorRanks(json.load(open(DATA / "creator_scores.json")), json.load(open(DATA / "projects.json")))
orders = [o for o in ORDERS if o.name in ("today", "+1 per reader of the last 24 h")]
orders.append(Order("+0.7 per reader of the last 24 h", reader_term=recent_readers(0.7, 24), demand_bump=False))
for window_days in (1, 14):
    for order in orders:
        row = summarize(order.name, replay(order, posts, slots, ranks, START, END, window_days, HORIZON), DAYS)
        print(f"window {window_days:2} d  {row['order']:34} {row['later_per_day']:6.1f} later readers a day")
