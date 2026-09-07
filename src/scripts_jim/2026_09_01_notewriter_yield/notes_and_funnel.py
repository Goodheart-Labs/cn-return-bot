# /// script
# requires-python = ">=3.10"
# dependencies = ["psycopg2-binary", "python-dotenv"]
# ///
"""Step 1 of the Sep 1 note-yield investigation (GOO-91): establish the fact.

The Aug 25 investigation (src/scripts_jim/2026_08_25_pipeline_note_yield/)
explained the Aug 21-25 drop: the OpenRouter monthly key limit, then the Brave
search cap starving the prefilter. The Aug 30 health check said the pipeline
had recovered to 54-68 submissions/day. Nathan reports low output on Sep 1,
so this script re-measures the recent window to see whether output dropped
again after Aug 30 and, if so, at which funnel stage.

Run from the workspace root:
  uv run src/scripts_jim/2026_09_01_notewriter_yield/notes_and_funnel.py
"""

import os

import psycopg2
from dotenv import load_dotenv

load_dotenv()

# The prefilter has three distinct "no note needed" paths. The verdict's
# reasoning text tells them apart, which matters because "every search query
# returned zero results" is a silent infrastructure failure, not a decision.
PREFILTER_WHY = """
  case
    when logs->'note_prefilter_steps'->'verdict'->>'reasoning'
         like 'query writer returned no queries%%' then 'no_queries'
    when logs->'note_prefilter_steps'->'verdict'->>'reasoning'
         like 'no evidence found%%' then 'zero_search_results'
    when logs->'note_prefilter_steps'->'verdict'->>'reasoning'
         like 'satire%%' then 'satire_gate'
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

    print_rows(cur, "Submitted notes per day (since Aug 10)", """
        select submitted_at::date, count(*)
        from notes where submitted_at >= '2026-08-10'
        group by 1 order by 1
    """)

    print_rows(cur, "Runs and outcomes per day (since Aug 20)", """
        select created_at::date as day, count(*) as runs,
          count(*) filter (where outcome='submitted') as submitted,
          count(*) filter (where outcome='candidate') as candidate,
          count(*) filter (where outcome='rejected') as rejected,
          count(*) filter (where outcome='failed') as failed
        from pipeline_runs where created_at >= '2026-08-20'
        group by 1 order by 1
    """)

    print_rows(cur, "Outcome reasons per day (since Aug 26)", """
        select created_at::date as day, outcome_reason, count(*)
        from pipeline_runs
        where created_at >= '2026-08-26'
        group by 1,2 having count(*) > 2 order by 1, 3 desc
    """)

    print_rows(cur, "Failure messages per day (since Aug 26)", """
        select created_at::date as day, left(error_message, 90) as err, count(*)
        from pipeline_runs
        where created_at >= '2026-08-26' and outcome='failed'
        group by 1,2 having count(*) > 2 order by 1, 3 desc
    """)

    print_rows(cur, "Why the prefilter said no, per day (since Aug 26)", f"""
        select created_at::date as day, {PREFILTER_WHY} as why, count(*)
        from pipeline_runs
        where outcome_reason='prefilter_no_note'
          and created_at >= '2026-08-26'
        group by 1,2 order by 1,3 desc
    """)

    conn.close()


if __name__ == "__main__":
    main()
