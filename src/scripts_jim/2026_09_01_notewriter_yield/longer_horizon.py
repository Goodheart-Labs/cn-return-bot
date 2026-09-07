# /// script
# requires-python = ">=3.10"
# dependencies = ["psycopg2-binary", "python-dotenv"]
# ///
"""Step 2: the recent daily numbers look recovered, so check the longer
horizon. Weekly submissions since April, plus what happens to notes after
submission (status mix per week), in case "writing fewer notes" is really
"fewer notes surviving to display".

Run from the workspace root:
  uv run src/scripts_jim/2026_09_01_notewriter_yield/longer_horizon.py
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

    print_rows(cur, "Submitted notes per week since April", """
        select date_trunc('week', submitted_at)::date as week, count(*)
        from notes where submitted_at >= '2026-04-01'
        group by 1 order by 1
    """)

    print_rows(cur, "Note status mix per week since July", """
        select date_trunc('week', submitted_at)::date as week,
          cn_status, count(*)
        from notes where submitted_at >= '2026-07-01'
        group by 1,2 order by 1, 3 desc
    """)

    print_rows(cur, "Runs per day vs distinct dispatches (since Aug 26)", """
        select created_at::date as day, count(*) as runs,
          count(distinct date_trunc('hour', created_at)) as active_hours
        from pipeline_runs where created_at >= '2026-08-26'
        group by 1 order by 1
    """)

    conn.close()


if __name__ == "__main__":
    main()
