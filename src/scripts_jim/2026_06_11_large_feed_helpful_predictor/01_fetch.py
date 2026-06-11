"""
Build the large-feed helpful-vs-NMR dataset.

Predict P(CURRENTLY_RATED_HELPFUL | tweet metrics) for notes we submitted
from the LARGE feed, using only columns from the `tweets` table.

Filters (the requested spec):
  - submitting pipeline_run had ab_test_picks->>'feed_size' = 'large'
  - cn_status in (CURRENTLY_RATED_HELPFUL, NEEDS_MORE_RATINGS)   (NH dropped)
  - submitted_at in [now - LOOKBACK_DAYS, now - HOLDOUT_DAYS]
      LOOKBACK_DAYS = 7  -> "last 7 days"
      HOLDOUT_DAYS  = 1  -> "excluding last 24 hours" (maturity cutoff: most
                            CRH lands within ~1 day; younger notes' label is
                            still in flight)
  - tweet present in `tweets` with all feature columns non-null

CLI:
  uv run 01_fetch.py             -> dataset.csv          (the 7-day window)
  uv run 01_fetch.py --all       -> dataset_all.csv      (all large-feed history)

Out: dataset.csv  (note_id, tweet_id, is_helpful, + tweet features)
"""
import csv
import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parents[2]
load_dotenv(PROJECT_ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

ALL_HISTORY = "--all" in sys.argv
LOOKBACK_DAYS = 7
HOLDOUT_DAYS = 1
PAGE = 200

# Tweet columns the model uses; null in any of these drops the row.
FEATURE_COLS = [
    "author_followers", "author_tweet_count", "impressions",
    "likes", "retweets", "replies", "quotes", "bookmarks",
    "has_video", "has_photo", "media_count",
]
REQUIRED_NONNULL = [
    "author_followers", "author_tweet_count", "posted_at", "impressions",
    "likes", "retweets", "replies", "quotes", "bookmarks",
]

now = datetime.now(timezone.utc)
window_end = now - timedelta(days=HOLDOUT_DAYS)
window_start = None if ALL_HISTORY else now - timedelta(days=LOOKBACK_DAYS)


def in_window(iso: str) -> bool:
    ts = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    if ts > window_end:
        return False
    if window_start is not None and ts < window_start:
        return False
    return True


def fetch_all_keyset(table, cols, key, extra=None):
    out, last = [], None
    while True:
        q = sb.table(table).select(cols).order(key).limit(1000)
        if last is not None:
            q = q.gt(key, last)
        if extra:
            q = extra(q)
        rows = q.execute().data
        if not rows:
            break
        out.extend(rows)
        last = rows[-1][key]
        if len(rows) < 1000:
            break
    return out


mode = "ALL large-feed history" if ALL_HISTORY else f"last {LOOKBACK_DAYS}d, excl. last {HOLDOUT_DAYS*24}h"
print(f"Mode: {mode}")
print(f"  window_end   = {window_end.isoformat()}")
print(f"  window_start = {window_start.isoformat() if window_start else '(none)'}\n")

# 1) Large-feed submitted runs -> note_ids. Filter the run's created_at to the
#    window up front so we only pull the relevant slice.
def run_extra(q):
    q = q.eq("ab_test_picks->>feed_size", "large").eq("outcome", "submitted")
    q = q.lte("created_at", window_end.isoformat())
    if window_start is not None:
        q = q.gte("created_at", window_start.isoformat())
    return q


print("Fetching large-feed submitted runs ...")
runs = fetch_all_keyset("pipeline_runs", "id, note_id, created_at", "id", run_extra)
note_ids = sorted({r["note_id"] for r in runs if r["note_id"]})
print(f"  -> {len(runs)} runs, {len(note_ids)} distinct note_ids")

# 2) Notes -> label, keep CRH/NMR submitted in window.
print("Fetching notes ...")
notes = []
for i in range(0, len(note_ids), PAGE):
    notes.extend(
        sb.table("notes")
        .select("note_id, tweet_id, cn_status, submitted_at")
        .in_("note_id", note_ids[i : i + PAGE])
        .execute()
        .data
    )
print("  cn_status:", dict(Counter(n["cn_status"] for n in notes)))
labelled = [
    n for n in notes
    if n["cn_status"] in ("CURRENTLY_RATED_HELPFUL", "NEEDS_MORE_RATINGS")
    and n["submitted_at"]
    and in_window(n["submitted_at"])
]
print(f"  -> {len(labelled)} CRH/NMR notes in window")

# 3) Tweets -> features.
tweet_ids = sorted({n["tweet_id"] for n in labelled})
print(f"Fetching {len(tweet_ids)} tweets ...")
tweets_by_id = {}
tcols = "tweet_id, posted_at, " + ", ".join(FEATURE_COLS)
for i in range(0, len(tweet_ids), PAGE):
    for t in sb.table("tweets").select(tcols).in_("tweet_id", tweet_ids[i : i + PAGE]).execute().data:
        tweets_by_id[t["tweet_id"]] = t

# 4) Join + require full feature data.
clean = []
for n in labelled:
    t = tweets_by_id.get(n["tweet_id"])
    if not t or any(t.get(c) is None for c in REQUIRED_NONNULL):
        continue
    submitted = datetime.fromisoformat(n["submitted_at"].replace("Z", "+00:00"))
    posted = datetime.fromisoformat(t["posted_at"].replace("Z", "+00:00"))
    clean.append({
        "note_id": n["note_id"],
        "tweet_id": n["tweet_id"],
        "is_helpful": 1 if n["cn_status"] == "CURRENTLY_RATED_HELPFUL" else 0,
        "submitted_at": n["submitted_at"],
        "tweet_age_at_submission_h": (submitted - posted).total_seconds() / 3600,
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

n_pos = sum(r["is_helpful"] for r in clean)
print(f"\nFinal dataset: {len(clean)} rows")
print(f"  CRH (positive): {n_pos} ({100*n_pos/len(clean):.1f}%)" if clean else "  (empty)")
print(f"  NMR (negative): {len(clean)-n_pos} ({100*(len(clean)-n_pos)/len(clean):.1f}%)" if clean else "")

out_path = HERE / ("dataset_all.csv" if ALL_HISTORY else "dataset.csv")
with open(out_path, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(clean[0].keys()))
    w.writeheader()
    w.writerows(clean)
print(f"\nWrote {out_path}")
