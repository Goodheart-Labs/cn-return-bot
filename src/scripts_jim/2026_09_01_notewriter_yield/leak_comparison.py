# /// script
# requires-python = ">=3.10"
# dependencies = ["psycopg2-binary", "python-dotenv"]
# ///
"""Step 3: compare per-day loss reasons between the pre-incident baseline
(Aug 10-20) and the recovered period (Aug 26 - Sep 1). If output "feels"
lower, a leak that grew shows up here as a higher daily average.

Run from the workspace root:
  uv run src/scripts_jim/2026_09_01_notewriter_yield/leak_comparison.py
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

    print_rows(cur, "Loss reasons: daily average, baseline vs now", """
        select coalesce(outcome_reason, outcome) as reason,
          round(count(*) filter (where created_at >= '2026-08-10'
            and created_at < '2026-08-21') / 11.0, 1) as baseline_per_day,
          round(count(*) filter (where created_at >= '2026-08-26'
            and created_at < '2026-09-01') / 6.0, 1) as now_per_day
        from pipeline_runs
        where (created_at >= '2026-08-10' and created_at < '2026-08-21')
           or (created_at >= '2026-08-26' and created_at < '2026-09-01')
        group by 1 order by 3 desc
    """)

    print_rows(cur, "Stale-at-submit: how old were the posts (since Aug 26)", """
        select created_at::date as day, count(*),
          round(avg(extract(epoch from (created_at - (logs->>'tweet_created_at')::timestamptz)) / 3600)::numeric, 1)
            as avg_post_age_h_at_run
        from pipeline_runs
        where outcome_reason = 'stale_at_submit' and created_at >= '2026-08-26'
        group by 1 order by 1
    """)

    conn.close()


if __name__ == "__main__":
    main()
