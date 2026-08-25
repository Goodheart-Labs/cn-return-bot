# /// script
# requires-python = ">=3.10"
# dependencies = ["psycopg2-binary", "python-dotenv"]
# ///
"""Step 2: walk the funnel in `pipeline_runs` and find where the notes are lost.

Prints, per day: run volume with outcome counts, the outcome_reason mix, and a
breakdown of WHY the prefilter said "no note needed". The prefilter has three
no paths, and the log verdict distinguishes them:
  - the query writer returned no queries (post is opinion/joke/non-checkable)
  - every search query returned zero results (this one is a silent search
    failure dressed up as a content decision)
  - the deepseek judge read real findings and said no

Also prints the hour-by-hour picture around the Aug 23 recovery, which is what
pins the moment search died to 2026-08-23 12:00 UTC.

Run from the workspace root: uv run src/scripts_jim/2026_08_25_pipeline_note_yield/funnel.py
"""

import os

import psycopg2
from dotenv import load_dotenv

load_dotenv()

PREFILTER_WHY = """
  case
    when logs->'note_prefilter_steps'->'verdict'->>'reasoning'
         like 'query writer returned no queries%%' then 'no_queries'
    when logs->'note_prefilter_steps'->'verdict'->>'reasoning'
         like 'no evidence found%%' then 'zero_search_results'
    else 'judge_said_no'
  end
"""


def print_rows(cur, title: str, sql: str) -> None:
    print(f"\n## {title}")
    cur.execute(sql)
    print("  ".join(d.name for d in cur.description))
    for row in cur.fetchall():
        print("  ".join(str(c) for c in row))


def main() -> None:
    conn = psycopg2.connect(os.environ["PROD_DB_URL"])
    cur = conn.cursor()

    print_rows(cur, "Runs and outcomes per day", """
        select created_at::date as day, count(*) as runs,
          count(*) filter (where outcome='submitted') as submitted,
          count(*) filter (where outcome='candidate') as candidate,
          count(*) filter (where outcome='rejected') as rejected,
          count(*) filter (where outcome='failed') as failed
        from pipeline_runs where created_at >= now() - interval '14 days'
        group by 1 order by 1
    """)

    print_rows(cur, "Failure messages per day (top rows)", """
        select created_at::date as day, left(error_message, 80) as err, count(*)
        from pipeline_runs
        where created_at >= now() - interval '14 days' and outcome='failed'
        group by 1,2 having count(*) > 3 order by 1, 3 desc
    """)

    print_rows(cur, "Why the prefilter said no, per day", f"""
        select created_at::date as day, {PREFILTER_WHY} as why, count(*)
        from pipeline_runs
        where outcome_reason='prefilter_no_note'
          and created_at >= now() - interval '14 days'
        group by 1,2 order by 1,3 desc
    """)

    print_rows(cur, "Hourly around the Aug 23 recovery", f"""
        select date_trunc('hour', created_at) as hour, count(*) as runs,
          count(*) filter (where outcome='failed') as failed,
          count(*) filter (where outcome_reason='prefilter_no_note'
            and {PREFILTER_WHY} = 'zero_search_results') as zero_results,
          count(*) filter (where outcome='submitted') as submitted
        from pipeline_runs
        where created_at >= '2026-08-23' and created_at < '2026-08-24 06:00'
        group by 1 order by 1
    """)

    conn.close()


if __name__ == "__main__":
    main()
