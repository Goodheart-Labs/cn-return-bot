# /// script
# requires-python = ">=3.10"
# dependencies = ["psycopg2-binary", "python-dotenv"]
# ///
"""Step 4: for the stale_at_submit losses, find how old the post was when the
run STARTED. If the post was already past (or within minutes of) the 24h
cutoff at selection, the note was doomed before any money was spent, and an
age filter at selection would have saved the slot for a fresher post.

First inspect one row's logs keys, then compute ages via the tweets table.

Run from the workspace root:
  uv run src/scripts_jim/2026_09_01_notewriter_yield/stale_ages.py
"""

import os

import psycopg2
from dotenv import load_dotenv

load_dotenv()


def print_rows(cur, title: str, sql: str) -> None:
    print(f"\n## {title}")
    cur.execute(sql)
    print("  ".join(d.name for d in cur.description))
    for row in cur.fetchall():
        print("  ".join(str(c) for c in row))


def main() -> None:
    conn = psycopg2.connect(os.environ["PROD_DB_URL"])
    cur = conn.cursor()

    print_rows(cur, "One stale run's top-level log keys", """
        select jsonb_object_keys(logs)
        from pipeline_runs
        where outcome_reason='stale_at_submit' and created_at >= '2026-08-30'
        limit 25
    """)

    print_rows(cur, "Post age at run start for stale_at_submit (since Aug 26)", """
        select pr.created_at::date as day,
          count(*) as stale_cut,
          round(avg(extract(epoch from (pr.created_at - t.posted_at)) / 3600)::numeric, 1) as avg_age_h_at_start,
          round(min(extract(epoch from (pr.created_at - t.posted_at)) / 3600)::numeric, 1) as min_age_h,
          round(max(extract(epoch from (pr.created_at - t.posted_at)) / 3600)::numeric, 1) as max_age_h,
          count(*) filter (where pr.created_at - t.posted_at >= interval '23 hours') as already_23h_plus
        from pipeline_runs pr
        join tweets t on t.tweet_id = pr.tweet_id
        where pr.outcome_reason='stale_at_submit' and pr.created_at >= '2026-08-26'
        group by 1 order by 1
    """)

    conn.close()


if __name__ == "__main__":
    main()
