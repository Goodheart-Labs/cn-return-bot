# /// script
# requires-python = ">=3.10"
# dependencies = ["psycopg2-binary", "python-dotenv", "pandas", "pyarrow"]
# ///
"""One-time READ-ONLY pull of the TEXT columns the LLM rater needs.

The sibling folder ../2026_09_18_outcome_screen/data/ already holds everything
except the actual words: no tweet text with a handle, no note text, no
materiality_engages score. This pulls exactly those, once.

Gentle on the 1 GB prod instance: read-only transaction, 60 s statement
timeout, narrow column lists, id-list lookups through indexes in chunks of 500,
a short sleep between chunks.  NEVER selects pipeline_runs.logs or
search_results.

Run:  uv run pull.py          (refuses to overwrite an existing pull; --force)
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
    out, ids = [], list(ids)
    for i in range(0, len(ids), CHUNK):
        out.append(q(cur, sql, (ids[i:i + CHUNK],)))
        time.sleep(0.3)
    df = pd.concat(out, ignore_index=True) if out else pd.DataFrame()
    print(f"  {label}: {len(df)} rows from {len(ids)} ids")
    return df


def main():
    if (DATA / "pull_meta.json").exists() and "--force" not in sys.argv:
        sys.exit("data/pull_meta.json exists; the pull is one-time. Pass --force to redo it.")
    DATA.mkdir(exist_ok=True)
    conn = connect()
    cur = conn.cursor()
    cur.execute("select now()")
    pulled_at = cur.fetchone()[0]
    cutoff = pd.Timestamp(pulled_at) - pd.Timedelta(days=7)
    print(f"  db now: {pulled_at}   maturity cutoff: {cutoff}")

    # 1. notes in the window. Narrow; note_text lives on pipeline_runs per the brief.
    notes = q(cur, """select note_id, tweet_id, cn_status, submitted_at, first_seen_at
                 from notes where coalesce(submitted_at, first_seen_at) >= %s""",
              (WINDOW_START,))
    print(f"  notes (window): {len(notes)} rows")
    when = notes["submitted_at"].fillna(notes["first_seen_at"])
    matured = notes[when < cutoff]
    tweets_ids = sorted(matured["tweet_id"].dropna().unique())
    print(f"  matured (< cutoff): {len(matured)}   distinct tweets: {len(tweets_ids)}")

    # 2. submitting pipeline_runs. Index is on tweet_id, so filter that way and
    #    join on note_id locally. note_text + source_url are what we came for.
    runs = chunked(cur, """select id::text as run_id, tweet_id, note_id, note_text, source_url, created_at
                 from pipeline_runs
                 where tweet_id = any(%s) and created_at >= '2026-08-01'
                   and (note_id is not null or outcome = 'submitted')""",
                   tweets_ids, "pipeline_runs")

    # 3. the binary materiality_engages flag for those runs (index on pipeline_run_id).
    scores = chunked(cur, """select pipeline_run_id::text as run_id, score_type, score_value, score_label, created_at
                 from pipeline_scores
                 where pipeline_run_id = any(%s::uuid[]) and score_type = 'materiality_engages'""",
                     sorted(runs["run_id"].dropna().unique()), "pipeline_scores (materiality_engages)")
    if len(scores):
        scores["score_value"] = scores["score_value"].astype(float)

    # 4. tweet text + handle, feed_tweets first then the tweets fallback.
    feed = chunked(cur, """select tweet_id, author_handle, text from feed_tweets
                 where tweet_id = any(%s)""", tweets_ids, "feed_tweets text")
    tw = chunked(cur, """select tweet_id, author_handle, text from tweets
                 where tweet_id = any(%s)""", tweets_ids, "tweets text")
    conn.close()

    notes.to_parquet(DATA / "notes.parquet")
    runs.to_parquet(DATA / "pipeline_runs_text.parquet")
    scores.to_parquet(DATA / "materiality_engages.parquet")
    feed.to_parquet(DATA / "feed_tweets_text.parquet")
    tw.to_parquet(DATA / "tweets_text.parquet")
    meta = {"pulled_at_utc": pd.Timestamp(pulled_at).isoformat(),
            "maturity_cutoff_utc": cutoff.isoformat(), "window_start": WINDOW_START,
            "n_window_notes": len(notes), "n_matured": len(matured), "n_tweets": len(tweets_ids),
            "rows": {"pipeline_runs_text": len(runs), "materiality_engages": len(scores),
                     "feed_tweets_text": len(feed), "tweets_text": len(tw)},
            "handle_non_null": {"feed_tweets": int(feed["author_handle"].notna().sum()) if len(feed) else 0,
                                "tweets": int(tw["author_handle"].notna().sum()) if len(tw) else 0}}
    (DATA / "pull_meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
