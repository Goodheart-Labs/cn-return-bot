"""
Build the dataset for the helpful-vs-NMR predictor.

Filters:
- cn_status in (CURRENTLY_RATED_HELPFUL, NEEDS_MORE_RATINGS)  -- skip NH
- submitted_at IS NOT NULL                                    -- our submissions only
- tweet exists in DB with full core fields                    -- complete data
- submitted_at <= today - MIN_AGE_DAYS                        -- mature enough to be rated
- (optional) bot + simple_bot_search variant                  -- BOT_NAME / SEARCH_VARIANT

Writes: dataset.csv
"""
import os
import csv
from pathlib import Path
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

MIN_AGE_DAYS = 1.5  # CRH typically lands within a couple of days. Notes younger
                     # than this are still in flight; older than ~1-2 days the
                     # label is mostly settled, so we keep the maximum sample.

# Restrict to a specific pipeline configuration via a pipeline_runs join.
# Set either to None to disable that filter.
BOT_NAME = "simple-bot"
SEARCH_VARIANT = "sonnet46-native"  # ab_test_picks->'simple_bot_search'

PAGE = 1000

# Columns whose null-rate tracks "did we have full Post data at processing time"
REQUIRED_TWEET_COLS = [
    "author_followers", "author_tweet_count",
    "posted_at", "impressions",
    "likes", "retweets", "replies", "quotes", "bookmarks",
]


def fetch_all_keyset(table, cols, key, extra=None):
    out, last = [], None
    while True:
        q = sb.table(table).select(cols).order(key).limit(PAGE)
        if last is not None:
            q = q.gt(key, last)
        if extra:
            q = extra(q)
        rows = q.execute().data
        if not rows:
            break
        out.extend(rows)
        last = rows[-1][key]
        if len(rows) < PAGE:
            break
    return out


print("Fetching notes ...")
notes = fetch_all_keyset(
    "notes",
    "note_id, tweet_id, cn_status, submitted_at",
    "note_id",
    lambda q: q.in_("cn_status", ["CURRENTLY_RATED_HELPFUL", "NEEDS_MORE_RATINGS"])
              .not_.is_("submitted_at", "null"),
)
print(f"  -> {len(notes)} CRH/NMR submitted notes")

now = datetime.now(timezone.utc)
cutoff = now - timedelta(days=MIN_AGE_DAYS)
mature = [
    n for n in notes
    if datetime.fromisoformat(n["submitted_at"].replace("Z", "+00:00")) <= cutoff
]
print(f"  -> {len(mature)} are >= {MIN_AGE_DAYS}d old")

# Optional bot/search-variant filter via pipeline_runs.note_id join.
if BOT_NAME or SEARCH_VARIANT:
    print(f"\nFiltering by bot={BOT_NAME!r}, search variant={SEARCH_VARIANT!r} ...")
    note_ids = sorted({n["note_id"] for n in mature})
    matching_note_ids = set()
    for i in range(0, len(note_ids), 200):
        chunk = note_ids[i : i + 200]
        q = sb.table("pipeline_runs").select("note_id, bot_name, ab_test_picks").in_("note_id", chunk)
        if BOT_NAME:
            q = q.eq("bot_name", BOT_NAME)
        if SEARCH_VARIANT:
            q = q.eq("ab_test_picks->>simple_bot_search", SEARCH_VARIANT)
        for r in q.execute().data:
            matching_note_ids.add(r["note_id"])
    mature = [n for n in mature if n["note_id"] in matching_note_ids]
    print(f"  -> {len(mature)} match the bot/variant filter")

tweet_ids = sorted({n["tweet_id"] for n in mature})
print(f"\nFetching {len(tweet_ids)} tweets ...")
tweets_by_id = {}
BATCH = 200
for i in range(0, len(tweet_ids), BATCH):
    chunk = tweet_ids[i : i + BATCH]
    cols = (
        "tweet_id, author_followers, author_tweet_count, posted_at, impressions, "
        "likes, retweets, replies, quotes, bookmarks, "
        "has_video, has_photo, media_count"
    )
    rows = sb.table("tweets").select(cols).in_("tweet_id", chunk).execute().data
    for t in rows:
        tweets_by_id[t["tweet_id"]] = t
print(f"  -> {len(tweets_by_id)} tweets")

# Filter to rows with full required data
clean = []
for n in mature:
    t = tweets_by_id.get(n["tweet_id"])
    if not t:
        continue
    if any(t.get(c) is None for c in REQUIRED_TWEET_COLS):
        continue
    submitted = datetime.fromisoformat(n["submitted_at"].replace("Z", "+00:00"))
    posted = datetime.fromisoformat(t["posted_at"].replace("Z", "+00:00"))
    tweet_age_at_submission_h = (submitted - posted).total_seconds() / 3600
    clean.append({
        "note_id": n["note_id"],
        "tweet_id": n["tweet_id"],
        "is_helpful": 1 if n["cn_status"] == "CURRENTLY_RATED_HELPFUL" else 0,
        "submitted_at": n["submitted_at"],
        "tweet_age_at_submission_h": tweet_age_at_submission_h,
        "author_followers": t["author_followers"],
        "author_tweet_count": t["author_tweet_count"],
        "impressions": t["impressions"],
        "likes": t["likes"],
        "retweets": t["retweets"],
        "replies": t["replies"],
        "quotes": t["quotes"],
        "bookmarks": t["bookmarks"],
        "has_video": int(bool(t.get("has_video"))),
        "has_photo": int(bool(t.get("has_photo"))),
        "media_count": t.get("media_count") or 0,
    })

print(f"\nFinal dataset: {len(clean)} rows")
n_pos = sum(r["is_helpful"] for r in clean)
print(f"  -> CRH (positive): {n_pos} ({n_pos / len(clean) * 100:.1f}%)")
print(f"  -> NMR (negative): {len(clean) - n_pos} ({(len(clean) - n_pos) / len(clean) * 100:.1f}%)")

out_path = HERE / "dataset.csv"
with open(out_path, "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=list(clean[0].keys()))
    writer.writeheader()
    writer.writerows(clean)
print(f"\nWrote {out_path}")
