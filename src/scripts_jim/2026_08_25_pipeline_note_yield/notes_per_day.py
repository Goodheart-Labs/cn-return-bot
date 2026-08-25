# /// script
# requires-python = ">=3.10"
# dependencies = ["psycopg2-binary", "python-dotenv"]
# ///
"""Step 1 of the note-yield investigation: establish the fact.

Prints submitted notes per week (since April) and per day (last 3 weeks)
from the prod `notes` table, so the size and start date of the drop are
visible before any explaining starts.

Run from the workspace root: uv run src/scripts_jim/2026_08_25_pipeline_note_yield/notes_per_day.py
"""

import os

import psycopg2
from dotenv import load_dotenv

load_dotenv()


def print_rows(cur, title: str, sql: str) -> None:
    print(f"\n## {title}")
    cur.execute(sql)
    for row in cur.fetchall():
        print("  ".join(str(c) for c in row))


def main() -> None:
    conn = psycopg2.connect(os.environ["PROD_DB_URL"])
    cur = conn.cursor()

    print_rows(cur, "Submitted notes per week", """
        select date_trunc('week', submitted_at)::date, count(*)
        from notes where submitted_at >= '2026-04-01'
        group by 1 order by 1
    """)

    print_rows(cur, "Submitted notes per day (last 3 weeks)", """
        select submitted_at::date, count(*)
        from notes where submitted_at >= now() - interval '21 days'
        group by 1 order by 1
    """)

    conn.close()


if __name__ == "__main__":
    main()
