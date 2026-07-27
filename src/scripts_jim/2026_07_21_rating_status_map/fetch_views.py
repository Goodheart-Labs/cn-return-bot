"""
Fetch every submitted note's outcome + note views, joined to its tweet's
impressions and age at first sight → views_sample.json.

The tweets table is insert-only (bulkInsertNewTweets, ignoreDuplicates), so
impressions are frozen at first sight and pair exactly with
first_seen_at − posted_at as the view count / age at fetch time.
"""
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env.local"); load_dotenv(ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

PAGE = 1000


def fetch_all(table: str, columns: str, order: str, filter_fn=None) -> list[dict]:
    rows, offset = [], 0
    while True:
        query = sb.table(table).select(columns).order(order)
        if filter_fn is not None:
            query = filter_fn(query)
        page = query.range(offset, offset + PAGE - 1).execute().data
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        offset += PAGE


notes = fetch_all("notes", "note_id, tweet_id, cn_status, view_count, submitted_at", "note_id",
                  lambda q: q.not_.is_("submitted_at", "null"))
print(f"submitted notes: {len(notes)}")

# The submitting run's feed-size pick (small / large / xl / xxl), latest run wins.
runs = fetch_all("pipeline_runs", "note_id, created_at, feed_size:ab_test_picks->>feed_size", "id",
                 lambda q: q.eq("outcome", "submitted").not_.is_("note_id", "null"))
feed_by_note = {}
for run in sorted(runs, key=lambda r: r["created_at"]):
    feed_by_note[run["note_id"]] = run["feed_size"]
print(f"submitted runs with feed pick: {sum(1 for v in feed_by_note.values() if v)}/{len(feed_by_note)}")

tweet_ids = sorted({n["tweet_id"] for n in notes if n["tweet_id"]})
tweets = {}
for start in range(0, len(tweet_ids), 150):
    batch = tweet_ids[start:start + 150]
    for t in sb.table("tweets").select("tweet_id, impressions, posted_at, first_seen_at") \
            .in_("tweet_id", batch).execute().data:
        tweets[t["tweet_id"]] = t
print(f"tweets matched: {len(tweets)}")

sample = [{**n, **tweets.get(n["tweet_id"], {}), "feed_size": feed_by_note.get(n["note_id"])} for n in notes]
(HERE / "views_sample.json").write_text(json.dumps(sample))
missing = sum(1 for s in sample if s.get("impressions") is None or s.get("posted_at") is None)
print(f"rows lacking impressions/posted_at: {missing}")
