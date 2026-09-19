# /// script
# requires-python = ">=3.10"
# dependencies = ["psycopg2-binary", "python-dotenv", "pandas", "pyarrow"]
# ///
"""One-time READ-ONLY pull for the outcome screen. Writes parquet files to ./data/.

Gentle on the 1 GB prod instance: read-only transaction, 60 s statement timeout,
narrow column lists, id-list lookups through indexes in chunks of 500, a short
sleep between chunks. Never selects pipeline_runs.logs / search_results /
bot_config, and only three sub-keys of feed_tweets.raw_tweet.

Run:  uv run pull.py          (refuses to overwrite an existing pull; pass --force)
"""
import json, os, sys, time
from pathlib import Path

import pandas as pd
import psycopg2
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
ENV_FILE = "/Users/natha/Documents/Source/cn-return-bot/.env"
WINDOW_START = "2026-08-07"
CHUNK = 500


def connect():
    load_dotenv(ENV_FILE)
    return psycopg2.connect(
        host="aws-1-eu-west-1.pooler.supabase.com", port=5432,
        user="postgres.ugytvkevhsmcpunfvncw", password=os.environ["SUPABASE_DB_PASSWORD"],
        dbname="postgres", connect_timeout=15,
        options="-c default_transaction_read_only=on -c statement_timeout=60000",
    )


def q(cur, sql, params=None):
    cur.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return pd.DataFrame(cur.fetchall(), columns=cols)


def chunked(cur, sql, ids, label):
    out = []
    ids = list(ids)
    for i in range(0, len(ids), CHUNK):
        out.append(q(cur, sql, (ids[i:i + CHUNK],)))
        time.sleep(0.3)
    df = pd.concat(out, ignore_index=True) if out else pd.DataFrame()
    print(f"  {label}: {len(df)} rows from {len(ids)} ids")
    return df


def jsonify(df, cols):
    for c in cols:
        df[c] = df[c].map(lambda v: None if v is None else json.dumps(v))
    return df


def main():
    if (DATA / "pull_meta.json").exists() and "--force" not in sys.argv:
        sys.exit("data/pull_meta.json exists; the pull is one-time. Pass --force to redo it.")
    DATA.mkdir(exist_ok=True)
    conn = connect()
    cur = conn.cursor()
    cur.execute("select now()")
    pulled_at = cur.fetchone()[0]

    # 1. notes: the whole table is ~9k rows; narrow columns only (no note_text).
    #    Older notes are needed for the out-of-time author-history feature.
    notes = q(cur, """select note_id, tweet_id, cn_status, submitted_at, first_seen_at,
                 rating_count, helpful_count, not_helpful_count, somewhat_helpful_count,
                 data_tier, notewriter_id from notes""")
    print(f"  notes: {len(notes)} rows")
    when = notes["submitted_at"].fillna(notes["first_seen_at"])
    win = notes[when >= pd.Timestamp(WINDOW_START, tz="UTC")]
    win_tweets = sorted(win["tweet_id"].dropna().unique())
    all_tweets = sorted(notes["tweet_id"].dropna().unique())
    print(f"  notes in window (>= {WINDOW_START}): {len(win)}  distinct tweets: {len(win_tweets)}")

    # 2. pipeline_runs for window tweets (index on tweet_id). Runs that carry a note_id
    #    or were submitted; nothing heavy selected.
    runs = chunked(cur, """select id::text as run_id, tweet_id, note_id, created_at, outcome,
                 ab_test_picks, bot_name, cost
                 from pipeline_runs
                 where tweet_id = any(%s) and created_at >= '2026-08-01'
                   and (note_id is not null or outcome = 'submitted')""", win_tweets, "pipeline_runs")
    runs = jsonify(runs, ["ab_test_picks"])
    runs["cost"] = runs["cost"].astype(float)

    # 3. evaluation scores for those runs (index on pipeline_run_id).
    scores = chunked(cur, """select pipeline_run_id::text as run_id, score_value, created_at
                 from pipeline_scores
                 where pipeline_run_id = any(%s::uuid[]) and score_type = 'evaluation'""",
                     sorted(runs["run_id"].unique()), "pipeline_scores")
    if len(scores):
        scores["score_value"] = scores["score_value"].astype(float)

    # 4. feed_tweets for window tweets (unique index on tweet_id). First-sight columns
    #    and three raw_tweet sub-keys only. The refreshed impressions/likes/retweets/
    #    replies columns are deliberately NOT pulled.
    feed = chunked(cur, """select tweet_id, author_id, author_handle, author_followers, author_tweet_count,
                 text, posted_at, first_seen_at, first_seen_impressions, first_seen_feed_size,
                 has_video, has_photo, media_count, referenced_tweets,
                 raw_tweet->'context_annotations' as context_annotations,
                 raw_tweet->>'lang' as lang,
                 raw_tweet->'public_metrics' as public_metrics
                 from feed_tweets where tweet_id = any(%s)""", win_tweets, "feed_tweets")
    feed = jsonify(feed, ["referenced_tweets", "context_annotations", "public_metrics"])

    # 5. author identity for ALL our noted tweets (history feature). Two narrow PK lookups.
    auth_feed = chunked(cur, """select tweet_id, author_id, author_handle from feed_tweets
                 where tweet_id = any(%s)""", all_tweets, "author ids (feed_tweets)")
    auth_tw = chunked(cur, """select tweet_id, author_id, author_handle from tweets
                 where tweet_id = any(%s)""", all_tweets, "author ids (tweets)")

    # 6. other people's notes on window tweets (index on tweet_id). our_note_id is null
    #    for missed-opportunity rows, which cannot match a tweet we noted, but filter anyway.
    comp = chunked(cur, """select tweet_id, note_id, our_note_id, current_status,
                 created_at_millis, classification
                 from competing_notes where tweet_id = any(%s) and our_note_id is not null""",
                   win_tweets, "competing_notes")
    conn.close()

    notes.to_parquet(DATA / "notes.parquet")
    runs.to_parquet(DATA / "pipeline_runs.parquet")
    scores.to_parquet(DATA / "pipeline_scores.parquet")
    feed.to_parquet(DATA / "feed_tweets.parquet")
    auth_feed.to_parquet(DATA / "author_ids_feed_tweets.parquet")
    auth_tw.to_parquet(DATA / "author_ids_tweets.parquet")
    comp.to_parquet(DATA / "competing_notes.parquet")
    meta = {"pulled_at_utc": pulled_at.isoformat(), "window_start": WINDOW_START,
            "rows": {"notes": len(notes), "pipeline_runs": len(runs), "pipeline_scores": len(scores),
                     "feed_tweets": len(feed), "author_ids_feed_tweets": len(auth_feed),
                     "author_ids_tweets": len(auth_tw), "competing_notes": len(comp)}}
    (DATA / "pull_meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
