# /// script
# requires-python = ">=3.10"
# dependencies = ["psycopg2-binary", "python-dotenv", "pandas", "pyarrow"]
# ///
"""Second READ-ONLY pull, for target B (will another author note this post?).

Adds the fetch-time fields the first pull did not need: the two live note-request
fields inside feed_tweets.raw_tweet, and the dump-presence check that says whether a
tweet with no competing_notes row really had no other note.

Same guards as pull.py: read-only transaction, 60 s timeout, narrow columns, id-list
lookups through indexes in chunks, sleeps between chunks.

Run:  uv run pull_b.py        (refuses to overwrite; pass --force)
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
CHUNK = 1000


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
    return pd.DataFrame(cur.fetchall(), columns=[d[0] for d in cur.description])


def chunked(cur, sql, ids, label):
    out, ids = [], list(ids)
    for i in range(0, len(ids), CHUNK):
        out.append(q(cur, sql, (ids[i:i + CHUNK],)))
        time.sleep(0.25)
    df = pd.concat(out, ignore_index=True) if out else pd.DataFrame()
    print(f"  {label}: {len(df)} rows from {len(ids)} ids")
    return df


def jsonify(df, cols):
    for c in cols:
        if c in df:
            df[c] = df[c].map(lambda v: None if v is None else json.dumps(v))
    return df


def main():
    if (DATA / "pull_b_meta.json").exists() and "--force" not in sys.argv:
        sys.exit("data/pull_b_meta.json exists; pass --force to redo it.")
    conn = connect()
    cur = conn.cursor()
    cur.execute("select now()")
    pulled_at = cur.fetchone()[0]

    notes = pd.read_parquet(DATA / "notes.parquet")
    when = notes["submitted_at"].fillna(notes["first_seen_at"])
    win_tweets = sorted(notes[when >= pd.Timestamp(WINDOW_START, tz="UTC")]["tweet_id"].dropna().unique())
    print(f"  window tweets: {len(win_tweets)}")

    feed = chunked(cur, """select tweet_id, author_id, author_followers, author_tweet_count,
                 text, posted_at, first_seen_at, first_seen_impressions, first_seen_feed_size,
                 has_video, has_photo, media_count, referenced_tweets,
                 raw_tweet->'note_request_suggestions' as note_request_suggestions,
                 raw_tweet->'suggested_source_links_with_counts' as suggested_source_links,
                 raw_tweet->'context_annotations' as context_annotations,
                 raw_tweet->>'lang' as lang,
                 raw_tweet->'public_metrics' as public_metrics,
                 (raw_tweet ? 'note_request_suggestions') as has_nrs_key
                 from feed_tweets where tweet_id = any(%s)""", win_tweets, "feed_tweets (fetch-time)")
    feed = jsonify(feed, ["referenced_tweets", "note_request_suggestions", "suggested_source_links",
                          "context_annotations", "public_metrics"])

    # Did OUR note make it into the public dump? If not, a tweet with no competing_notes
    # row is censored rather than genuinely un-noted.
    snap = chunked(cur, """select tweet_id, note_id, min(snapshot_date) as first_snapshot
                 from public_data_snapshots where tweet_id = any(%s) and is_ours
                 group by 1, 2""", win_tweets, "public_data_snapshots (ours)")
    conn.close()

    feed.to_parquet(DATA / "feed_fetchtime.parquet")
    snap.to_parquet(DATA / "our_dump_presence.parquet")
    meta = {"pulled_at_utc": pulled_at.isoformat(), "window_tweets": len(win_tweets),
            "rows": {"feed_fetchtime": len(feed), "our_dump_presence": len(snap)},
            "nrs_key_present": int(feed["has_nrs_key"].sum()) if len(feed) else 0}
    (DATA / "pull_b_meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
