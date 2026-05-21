"""
How many rows survive at each maturity cutoff?

Joins notes (CRH/NMR, submitted) to tweets, requires the same core columns
the model needs, and reports rows + positives at cutoffs 0..60 days.
"""
import os
from pathlib import Path
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

REQUIRED = [
    "author_followers", "author_tweet_count", "posted_at", "impressions",
    "likes", "retweets", "replies", "quotes", "bookmarks",
]
PAGE = 1000


def fetch_all(table, cols, key, extra=None):
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


notes = fetch_all(
    "notes", "note_id, tweet_id, cn_status, submitted_at", "note_id",
    lambda q: q.in_("cn_status", ["CURRENTLY_RATED_HELPFUL", "NEEDS_MORE_RATINGS"])
              .not_.is_("submitted_at", "null"),
)
tweet_ids = sorted({n["tweet_id"] for n in notes})

tweets_by_id = {}
for i in range(0, len(tweet_ids), 200):
    chunk = tweet_ids[i : i + 200]
    rows = sb.table("tweets").select("tweet_id, " + ", ".join(REQUIRED)).in_("tweet_id", chunk).execute().data
    for t in rows:
        tweets_by_id[t["tweet_id"]] = t

# Pre-compute: per note, do we have a complete tweet?
joined = []
for n in notes:
    t = tweets_by_id.get(n["tweet_id"])
    if not t:
        continue
    if any(t.get(c) is None for c in REQUIRED):
        continue
    joined.append({
        "submitted_at": datetime.fromisoformat(n["submitted_at"].replace("Z", "+00:00")),
        "is_helpful": 1 if n["cn_status"] == "CURRENTLY_RATED_HELPFUL" else 0,
    })

now = datetime.now(timezone.utc)
print(f"Total notes with complete tweet data: {len(joined)}")
print(f"  -> CRH: {sum(r['is_helpful'] for r in joined)}")
earliest = min(r["submitted_at"] for r in joined)
print(f"  -> earliest submitted_at with complete data: {earliest.isoformat()}")
print(f"  -> (today is {now.isoformat()})\n")

print(f"{'cutoff_d':>9}  {'n_rows':>7}  {'n_CRH':>6}  {'pct_CRH':>8}")
for cutoff in [0, 3, 7, 10, 14, 21, 30, 45, 60]:
    deadline = now - timedelta(days=cutoff)
    rows = [r for r in joined if r["submitted_at"] <= deadline]
    n = len(rows)
    pos = sum(r["is_helpful"] for r in rows)
    pct = pos / n * 100 if n else 0
    print(f"{cutoff:>9}  {n:>7}  {pos:>6}  {pct:>7.1f}%")
