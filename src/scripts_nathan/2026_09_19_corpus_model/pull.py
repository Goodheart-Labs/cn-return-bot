# /// script
# requires-python = ">=3.10"
# dependencies = ["psycopg2-binary", "python-dotenv", "pandas", "pyarrow"]
# ///
"""One-time READ-ONLY pull for the corpus-transfer experiment. Writes ./data/*.parquet.

Gentle on the 1 GB prod instance (it has had an IO outage and two other agents may be
reading it): read-only transaction, 60 s statement timeout, narrow column lists,
keyset paging on competing_notes.id, id-list lookups through indexes in chunks, a
short sleep between chunks. Never selects pipeline_runs.logs, search_results or
bot_config.

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
PAGE = 2000      # keyset page for competing_notes
CHUNK = 1000     # id-list chunk for = any(%s) index lookups


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
        time.sleep(0.25)
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
    print(f"  db now: {pulled_at}")

    # 1. competing_notes, whole table, keyset paged on the uuid primary key.
    #    our_note_id NULL = "missed opportunity" rows (tweets we rejected); kept on
    #    purpose so the selection can be measured, not silently dropped.
    #    Resume guard: a completed stage is never re-read from the database.
    if (DATA / "competing_notes.parquet").exists():
        comp = pd.read_parquet(DATA / "competing_notes.parquet")
        print(f"  competing_notes: reusing local parquet ({len(comp)} rows)")
        pages, last = None, None
    else:
        pages, last = [], "00000000-0000-0000-0000-000000000000"
    while pages is not None:
        p = q(cur, """select id::text as row_id, note_id, tweet_id, our_note_id, note_text,
                   classification, current_status, created_at_millis, first_seen_date
                   from competing_notes where id > %s::uuid order by id limit %s""", (last, PAGE))
        if not len(p):
            break
        pages.append(p)
        last = p["row_id"].iloc[-1]
        time.sleep(0.25)
        if len(p) < PAGE:
            break
    if pages is not None:
        comp = pd.concat(pages, ignore_index=True)
        comp.to_parquet(DATA / "competing_notes.parquet")
    print(f"  competing_notes: {len(comp)} rows, {comp['note_id'].nunique()} distinct note_id, "
          f"{comp['tweet_id'].nunique()} distinct tweet_id")

    comp_tweets = sorted(comp["tweet_id"].dropna().unique())

    # 2. tweet text for those tweets: feed_tweets first (unique index on tweet_id),
    #    then the `tweets` table (primary key on tweet_id) for whatever feed_tweets misses.
    if (DATA / "tweet_text_feed.parquet").exists():
        ft = pd.read_parquet(DATA / "tweet_text_feed.parquet")
        print(f"  feed_tweets text: reusing local parquet ({len(ft)} rows)")
    else:
        ft = chunked(cur, """select tweet_id, text, posted_at, author_id from feed_tweets
                     where tweet_id = any(%s)""", comp_tweets, "feed_tweets text")
        ft.to_parquet(DATA / "tweet_text_feed.parquet")
    missing = sorted(set(comp_tweets) - set(ft["tweet_id"]))
    tw = chunked(cur, """select tweet_id, text, posted_at, author_id from tweets
                 where tweet_id = any(%s)""", missing, "tweets text (fallback)")

    # 3. our own notes (whole table, ~9k narrow rows) and the submitting runs' note_text.
    notes = q(cur, """select note_id, tweet_id, cn_status, submitted_at, first_seen_at
                 from notes""")
    print(f"  notes: {len(notes)} rows")
    when = notes["submitted_at"].fillna(notes["first_seen_at"])
    win = notes[when >= pd.Timestamp(WINDOW_START, tz="UTC")]
    win_tweets = sorted(win["tweet_id"].dropna().unique())
    print(f"  notes in window (>= {WINDOW_START}): {len(win)}  distinct tweets: {len(win_tweets)}")

    # index on pipeline_runs(tweet_id); no index on note_id, so go through tweet_id.
    runs = chunked(cur, """select id::text as run_id, tweet_id, note_id, note_text, created_at
                 from pipeline_runs
                 where tweet_id = any(%s) and created_at >= '2026-08-01'
                   and (note_id is not null or outcome = 'submitted')""",
                   win_tweets, "pipeline_runs note_text")
    conn.close()

    comp.to_parquet(DATA / "competing_notes.parquet")
    ft.to_parquet(DATA / "tweet_text_feed.parquet")
    tw.to_parquet(DATA / "tweet_text_tweets.parquet")
    notes.to_parquet(DATA / "notes.parquet")
    runs.to_parquet(DATA / "pipeline_runs.parquet")
    meta = {
        "pulled_at_utc": pulled_at.isoformat(), "window_start": WINDOW_START,
        "rows": {"competing_notes": len(comp), "tweet_text_feed": len(ft),
                 "tweet_text_tweets": len(tw), "notes": len(notes), "pipeline_runs": len(runs)},
        "competing_distinct": {"note_id": int(comp["note_id"].nunique()),
                               "tweet_id": int(comp["tweet_id"].nunique()),
                               "our_note_id_null": int(comp["our_note_id"].isna().sum())},
        "tweet_text_coverage": {"asked": len(comp_tweets), "feed_tweets": int(ft["tweet_id"].nunique()),
                                "tweets_fallback": int(tw["tweet_id"].nunique()) if len(tw) else 0},
    }
    (DATA / "pull_meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
