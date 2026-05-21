"""
Exploration: figure out how many notes we have where cn_status is
CURRENTLY_RATED_HELPFUL or NEEDS_MORE_RATINGS, and how many also have
complete tweet-side data (impressions, author followers, posted_at, etc).

Goal: pick a clean cutoff date / completeness filter for the model.
"""
import os
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

PAGE = 1000


def fetch_all(table: str, cols: str, key: str, extra_filter=None):
    """Keyset pagination on `key` (ascending)."""
    out, last = [], None
    while True:
        q = sb.table(table).select(cols).order(key).limit(PAGE)
        if last is not None:
            q = q.gt(key, last)
        if extra_filter:
            q = extra_filter(q)
        rows = q.execute().data
        if not rows:
            break
        out.extend(rows)
        last = rows[-1][key]
        if len(rows) < PAGE:
            break
    return out


print("Fetching notes (CRH or NMR only, with submitted_at not null) ...")
notes = fetch_all(
    "notes",
    "note_id, tweet_id, cn_status, submitted_at, first_seen_at, "
    "rating_count, helpful_count, somewhat_helpful_count, not_helpful_count, "
    "view_count, data_tier",
    "note_id",
    lambda q: q.in_("cn_status", ["CURRENTLY_RATED_HELPFUL", "NEEDS_MORE_RATINGS"]),
)
print(f"  -> {len(notes)} notes (CRH or NMR)")

submitted = [n for n in notes if n.get("submitted_at")]
print(f"  -> {len(submitted)} have submitted_at (bot wrote these)")

status_counts = Counter(n["cn_status"] for n in submitted)
print(f"  -> by status: {dict(status_counts)}")

# Earliest submitted_at
submitted_sorted = sorted(submitted, key=lambda n: n["submitted_at"])
print(f"  -> earliest submitted_at: {submitted_sorted[0]['submitted_at']}")
print(f"  -> latest   submitted_at: {submitted_sorted[-1]['submitted_at']}")

# Fetch the tweets for those notes in batches
tweet_ids = sorted({n["tweet_id"] for n in submitted})
print(f"\nFetching tweets for {len(tweet_ids)} tweet_ids ...")
tweets_by_id = {}
BATCH = 200
for i in range(0, len(tweet_ids), BATCH):
    chunk = tweet_ids[i : i + BATCH]
    resp = sb.table("tweets").select(
        "tweet_id, author_id, author_followers, author_tweet_count, "
        "posted_at, impressions, likes, retweets, replies, quotes, bookmarks, "
        "has_video, has_photo, media_count, video_duration_ms, first_seen_at"
    ).in_("tweet_id", chunk).execute().data
    for t in resp:
        tweets_by_id[t["tweet_id"]] = t

print(f"  -> {len(tweets_by_id)} tweets retrieved")

# Completeness per column
print("\n=== TWEET-COLUMN NULL RATE (across notes whose tweet we found) ===")
cols_to_check = [
    "author_followers", "author_tweet_count",
    "posted_at", "impressions",
    "likes", "retweets", "replies", "quotes", "bookmarks",
    "has_video", "has_photo", "media_count", "video_duration_ms",
]
have_tweet = [n for n in submitted if n["tweet_id"] in tweets_by_id]
print(f"Notes whose tweet exists in DB: {len(have_tweet)} / {len(submitted)}")

for c in cols_to_check:
    n_null = sum(1 for n in have_tweet if tweets_by_id[n["tweet_id"]].get(c) is None)
    print(f"  {c:25s}  null: {n_null:5d}  ({n_null / len(have_tweet) * 100:5.1f}%)")

# Notes with full data on the *core* features the user mentioned
core_cols = ["author_followers", "author_tweet_count", "posted_at", "impressions"]
fully_present = [
    n for n in have_tweet
    if all(tweets_by_id[n["tweet_id"]].get(c) is not None for c in core_cols)
    and n.get("submitted_at")
]
print(f"\nNotes with all core tweet columns + submitted_at: {len(fully_present)}")

# Bucket by month of submitted_at to see when data became complete
by_month = defaultdict(lambda: {"total": 0, "complete": 0, "crh": 0, "nmr": 0})
for n in submitted:
    if not n.get("submitted_at"):
        continue
    m = n["submitted_at"][:7]  # YYYY-MM
    by_month[m]["total"] += 1
    t = tweets_by_id.get(n["tweet_id"])
    if t and all(t.get(c) is not None for c in core_cols):
        by_month[m]["complete"] += 1
        if n["cn_status"] == "CURRENTLY_RATED_HELPFUL":
            by_month[m]["crh"] += 1
        else:
            by_month[m]["nmr"] += 1

print("\n=== COMPLETENESS BY MONTH OF submitted_at ===")
print(f"{'month':>8}  {'total':>6}  {'complete':>9}  {'%':>6}  {'CRH':>5}  {'NMR':>5}")
for m in sorted(by_month):
    d = by_month[m]
    pct = d["complete"] / d["total"] * 100 if d["total"] else 0
    print(f"{m:>8}  {d['total']:>6}  {d['complete']:>9}  {pct:5.1f}%  {d['crh']:>5}  {d['nmr']:>5}")

# Also: how recent is the note? Many recent NMR notes will eventually become CRH.
# Add note age (days since submitted_at)
now = datetime.now(timezone.utc)
print("\n=== AGE OF NMR vs CRH NOTES (days since submitted_at) ===")
for st in ["CURRENTLY_RATED_HELPFUL", "NEEDS_MORE_RATINGS"]:
    ages = []
    for n in submitted:
        if n["cn_status"] != st:
            continue
        dt = datetime.fromisoformat(n["submitted_at"].replace("Z", "+00:00"))
        ages.append((now - dt).total_seconds() / 86400)
    if not ages:
        continue
    ages.sort()
    n = len(ages)
    print(
        f"{st}: n={n} median={ages[n // 2]:.1f}d "
        f"p25={ages[n // 4]:.1f}d p75={ages[3 * n // 4]:.1f}d "
        f"min={ages[0]:.1f}d max={ages[-1]:.1f}d"
    )
