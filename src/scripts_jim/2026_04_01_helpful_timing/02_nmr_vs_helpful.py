"""
For all our NMR notes that have helpful competing notes on the same tweet:
1. Dump pairs for similarity classification
2. Plot average competitor note count over time
"""
import os, json
from pathlib import Path
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from dotenv import load_dotenv
from supabase import create_client

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


# 1. Get our notes with status from canonical_note_information
print("Fetching our notes...")
our_notes = fetch_all(
    "canonical_note_information",
    "note_id, tweet_id, note_text, cn_status, first_seen_at, data_tier"
)
print(f"  Total: {len(our_notes)}")

# Also get created_at_millis from public_data_snapshots for our notes
print("Fetching our notes' timestamps from public_data_snapshots...")
our_snapshots = fetch_all(
    "public_data_snapshots",
    "note_id, created_at_millis, snapshot_date",
    [("is_ours", "eq", True)],
)
# Dedupe: latest snapshot per note
our_ts = {}
for s in our_snapshots:
    nid = s["note_id"]
    if nid not in our_ts or s["snapshot_date"] > our_ts[nid]["snapshot_date"]:
        our_ts[nid] = s

# Filter our notes: NMR status, exclude junk
nmr_notes = [
    n for n in our_notes
    if n["cn_status"] and "NEEDS_MORE_RATINGS" in n["cn_status"]
    and n["data_tier"] != "junk"
]
print(f"  NMR (non-junk): {len(nmr_notes)}")

nmr_tweet_ids = {n["tweet_id"] for n in nmr_notes}
nmr_by_tweet = defaultdict(list)
for n in nmr_notes:
    nmr_by_tweet[n["tweet_id"]].append(n)

# 2. Get all competing notes
print("Fetching competing notes...")
competing = fetch_all(
    "competing_notes",
    "tweet_id, note_id, our_note_id, note_text, current_status, created_at_millis, author_participant_id"
)
print(f"  Total competing: {len(competing)}")

# Group competing by tweet
comp_by_tweet = defaultdict(list)
for c in competing:
    comp_by_tweet[c["tweet_id"]].append(c)

# 3. Find our NMR notes where tweet has helpful competing notes
def is_helpful(status):
    return status and "HELPFUL" in status and "NOT" not in status

pairs = []
for tweet_id, our_list in nmr_by_tweet.items():
    helpful_comps = [c for c in comp_by_tweet.get(tweet_id, []) if is_helpful(c["current_status"])]
    if not helpful_comps:
        continue
    for our_note in our_list:
        our_millis = our_ts.get(our_note["note_id"], {}).get("created_at_millis")
        for hc in helpful_comps:
            pairs.append({
                "tweet_id": tweet_id,
                "our_note_id": our_note["note_id"],
                "our_note_text": our_note["note_text"] or "",
                "our_created_ms": our_millis,
                "helpful_note_id": hc["note_id"],
                "helpful_note_text": hc["note_text"] or "",
                "helpful_created_ms": hc["created_at_millis"],
                "helpful_author": hc["author_participant_id"],
            })

print(f"\n  Our NMR notes with helpful competitors: {len(set(p['our_note_id'] for p in pairs))}")
print(f"  Total (our NMR, helpful competitor) pairs: {len(pairs)}")

# Dedupe pairs by (our_note_id, helpful_note_id)
seen = set()
deduped = []
for p in pairs:
    key = (p["our_note_id"], p["helpful_note_id"])
    if key not in seen:
        seen.add(key)
        deduped.append(p)
pairs = deduped
print(f"  Deduped pairs: {len(pairs)}")

# Write pairs for classification (compact)
classify_data = []
for i, p in enumerate(pairs):
    classify_data.append({
        "i": i,
        "our_text": p["our_note_text"][:500],
        "helpful_text": p["helpful_note_text"][:500],
    })

# Split into chunks of ~40
chunk_size = 40
for ci in range(0, len(classify_data), chunk_size):
    chunk = classify_data[ci:ci + chunk_size]
    with open(OUT_DIR / f"nmr_chunk_{ci // chunk_size}.json", "w") as f:
        json.dump(chunk, f, indent=2)
    print(f"  Wrote chunk {ci // chunk_size}: {len(chunk)} pairs")

# Save full pairs for later analysis
with open(OUT_DIR / "nmr_pairs_full.json", "w") as f:
    json.dump(pairs, f, indent=2)

# 4. Plot average competitor notes over time
print("\nComputing competitor counts over time...")

# For each of our notes, count competing notes and bucket by month
all_our_notes_by_tweet = defaultdict(list)
for n in our_notes:
    if n["data_tier"] != "junk":
        all_our_notes_by_tweet[n["tweet_id"]].append(n)

# Parse first_seen_at into month buckets
monthly_comp_counts = defaultdict(list)
for n in our_notes:
    if n["data_tier"] == "junk" or not n["first_seen_at"]:
        continue
    tid = n["tweet_id"]
    n_comps = len(comp_by_tweet.get(tid, []))
    # Parse date
    dt_str = n["first_seen_at"]
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        month_key = dt.strftime("%Y-%m")
    except:
        continue
    monthly_comp_counts[month_key].append(n_comps)

# Also weekly for more granularity
weekly_comp_counts = defaultdict(list)
for n in our_notes:
    if n["data_tier"] == "junk" or not n["first_seen_at"]:
        continue
    tid = n["tweet_id"]
    n_comps = len(comp_by_tweet.get(tid, []))
    dt_str = n["first_seen_at"]
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        # Week start (Monday)
        week_start = dt - timedelta(days=dt.weekday())
        week_key = week_start.strftime("%Y-%m-%d")
    except:
        continue
    weekly_comp_counts[week_key].append(n_comps)

print("\nMonthly average competitor notes per tweet:")
for month in sorted(monthly_comp_counts):
    counts = monthly_comp_counts[month]
    avg = sum(counts) / len(counts)
    has_any = sum(1 for c in counts if c > 0)
    print(f"  {month}: avg={avg:.2f}, {has_any}/{len(counts)} tweets have competitors ({has_any/len(counts):.0%})")

# Plot
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    weeks = sorted(weekly_comp_counts)
    avgs = [sum(weekly_comp_counts[w]) / len(weekly_comp_counts[w]) for w in weeks]
    counts = [len(weekly_comp_counts[w]) for w in weeks]

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 8), sharex=True)

    ax1.bar(range(len(weeks)), avgs, color="steelblue", alpha=0.8)
    ax1.set_ylabel("Avg competitor notes per tweet")
    ax1.set_title("Competitor Notes Over Time (weekly)")
    ax1.axhline(y=sum(c for vals in weekly_comp_counts.values() for c in vals) / sum(len(v) for v in weekly_comp_counts.values()),
                color="red", linestyle="--", alpha=0.5, label="overall avg")
    ax1.legend()

    ax2.bar(range(len(weeks)), counts, color="gray", alpha=0.6)
    ax2.set_ylabel("Our notes submitted")
    ax2.set_xticks(range(0, len(weeks), max(1, len(weeks) // 15)))
    ax2.set_xticklabels([weeks[i] for i in range(0, len(weeks), max(1, len(weeks) // 15))], rotation=45, ha="right")

    plt.tight_layout()
    plt.savefig(OUT_DIR / "competitor_counts.png", dpi=150)
    print(f"\nSaved plot to {OUT_DIR / 'competitor_counts.png'}")
except ImportError:
    print("matplotlib not installed, skipping plot")
