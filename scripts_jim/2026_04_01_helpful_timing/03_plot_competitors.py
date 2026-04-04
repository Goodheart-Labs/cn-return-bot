"""Plot average competitor notes per tweet over time (weekly)."""
import os, json
from pathlib import Path
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from dotenv import load_dotenv
from supabase import create_client
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = Path(__file__).parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])


def fetch_all(table, select, filters=None):
    rows, offset, page = [], 0, 1000
    while True:
        q = sb.table(table).select(select)
        if filters:
            for col, op, val in filters:
                q = q.filter(col, op, val)
        resp = q.range(offset, offset + page - 1).execute()
        rows.extend(resp.data)
        if len(resp.data) < page:
            break
        offset += page
    return rows


our_notes = fetch_all("canonical_note_information", "note_id, tweet_id, first_seen_at, data_tier")
our_note_ids = {n["note_id"] for n in our_notes if n["data_tier"] != "junk"}

# Only count competitors linked to our actual notes (via our_note_id FK)
competing = fetch_all("competing_notes", "tweet_id, note_id, our_note_id")

comp_count_by_tweet = defaultdict(int)
for c in competing:
    if c["our_note_id"] in our_note_ids:
        comp_count_by_tweet[c["tweet_id"]] += 1

# Weekly buckets
weekly = defaultdict(list)
for n in our_notes:
    if n["data_tier"] == "junk" or not n["first_seen_at"]:
        continue
    try:
        dt = datetime.fromisoformat(n["first_seen_at"].replace("Z", "+00:00"))
        week_start = dt - timedelta(days=dt.weekday())
        key = week_start.strftime("%Y-%m-%d")
    except:
        continue
    weekly[key].append(comp_count_by_tweet.get(n["tweet_id"], 0))

weeks = sorted(weekly)
avgs = [sum(weekly[w]) / len(weekly[w]) for w in weeks]
ns = [len(weekly[w]) for w in weeks]
overall_avg = sum(c for v in weekly.values() for c in v) / sum(len(v) for v in weekly.values())

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 7), sharex=True, gridspec_kw={"height_ratios": [2, 1]})

ax1.bar(range(len(weeks)), avgs, color="steelblue", alpha=0.8)
ax1.axhline(y=overall_avg, color="red", linestyle="--", alpha=0.5, label=f"overall avg ({overall_avg:.2f})")
ax1.set_ylabel("Avg competitor notes\nper tweet")
ax1.set_title("Competitor Notes Over Time (weekly)")
ax1.legend()
ax1.set_ylim(0, max(avgs) * 1.15)

ax2.bar(range(len(weeks)), ns, color="gray", alpha=0.6)
ax2.set_ylabel("Our notes\nsubmitted")

# Show every 2nd week label
step = max(1, len(weeks) // 20)
ax2.set_xticks(range(0, len(weeks), step))
ax2.set_xticklabels([weeks[i] for i in range(0, len(weeks), step)], rotation=45, ha="right", fontsize=9)

plt.tight_layout()
plt.savefig(OUT_DIR / "competitor_counts.png", dpi=150, bbox_inches="tight")
print(f"Saved to {OUT_DIR / 'competitor_counts.png'}")
print(f"\nWeeks: {len(weeks)}, range: {weeks[0]} to {weeks[-1]}")
print(f"Overall avg competitors: {overall_avg:.2f}")
