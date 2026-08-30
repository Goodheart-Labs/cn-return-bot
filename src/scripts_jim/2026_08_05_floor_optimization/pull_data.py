"""Pull the three datasets the floor analysis needs into data/*.json.

1. pipeline_runs since June (feed_size picks reliable from then on): every
   processed post with its outcome, feed tier and misinfo flag. This gives the
   submit-conversion rate per tier and velocity, not just submitted notes.
2. notes for those runs: settled cn_status per submitted note.
3. tweets rows for every involved tweet: impressions are frozen at first
   insert, so first-sight velocity is impressions / age-at-first-seen.
4. feed_tweets arrivals since the archive warm-up: the per-tier supply record.
"""

import json
import os

from supabase_rest import fetch_all, rest_get

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
RUNS_SINCE = "2026-06-01"
# The archive merged 2026-08-07; the first run flushed the standing backlog, so
# arrivals are only meaningful from the next day onward.
SUPPLY_SINCE = "2026-08-08"
CHUNK = 150


def chunked(items, size):
    return [items[i : i + size] for i in range(0, len(items), size)]


def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    runs = fetch_all(
        "pipeline_runs",
        {
            "select": "id,tweet_id,note_id,created_at,outcome,outcome_reason,"
            "feed_size:ab_test_picks->>feed_size,misinfo:ab_test_picks->>misinfo_monitoring",
            "created_at": f"gte.{RUNS_SINCE}",
        },
        order_col="id",
    )
    print(f"pipeline_runs since {RUNS_SINCE}: {len(runs)}")
    json.dump(runs, open(os.path.join(DATA_DIR, "runs.json"), "w"))

    note_ids = sorted({r["note_id"] for r in runs if r["note_id"]})
    notes = []
    for batch in chunked(note_ids, CHUNK):
        notes.extend(
            rest_get(
                "notes",
                {
                    "select": "note_id,tweet_id,submitted_at,cn_status",
                    "note_id": f"in.({','.join(batch)})",
                },
            )
        )
    print(f"notes: {len(notes)}")
    json.dump(notes, open(os.path.join(DATA_DIR, "notes.json"), "w"))

    tweet_ids = sorted({r["tweet_id"] for r in runs if r["tweet_id"]})
    tweets = []
    for batch in chunked(tweet_ids, CHUNK):
        tweets.extend(
            rest_get(
                "tweets",
                {
                    "select": "tweet_id,impressions,posted_at,first_seen_at",
                    "tweet_id": f"in.({','.join(batch)})",
                },
            )
        )
    print(f"tweets: {len(tweets)}")
    json.dump(tweets, open(os.path.join(DATA_DIR, "tweets.json"), "w"))

    supply = fetch_all(
        "feed_tweets",
        {
            "select": "tweet_id,posted_at,first_seen_at,first_seen_impressions,first_seen_feed_size",
            "first_seen_at": f"gte.{SUPPLY_SINCE}",
        },
        order_col="tweet_id",
    )
    print(f"feed_tweets arrivals since {SUPPLY_SINCE}: {len(supply)}")
    json.dump(supply, open(os.path.join(DATA_DIR, "supply.json"), "w"))


if __name__ == "__main__":
    main()
