# /// script
# requires-python = ">=3.10"
# dependencies = ["psycopg2-binary", "python-dotenv"]
# ///
"""Notewriter + everything-pipeline health check (GOO-72).

Prints every number the RESULTS.md findings rest on, so the check can be
re-run any day: X-pipeline outcomes and failure reasons, the satire gate's
first live firings, everything-pipeline run outcomes and daily cost against
the spend cap, the error-item families, and the reader-request backlogs.

Run from the workspace root: uv run src/scripts_jim/2026_08_30_notewriter_health/healthcheck.py
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

    print_rows(cur, "X pipeline: outcomes per day (7 days)", """
        select created_at::date, outcome, count(*)
        from pipeline_runs
        where created_at > now() - interval '7 days'
        group by 1, 2 order by 1 desc, 2
    """)

    print_rows(cur, "X pipeline: outcome reasons (3 days)", """
        select outcome_reason, count(*), max(created_at)
        from pipeline_runs
        where created_at > now() - interval '3 days' and outcome in ('failed', 'rejected')
        group by 1 order by 2 desc
    """)

    print_rows(cur, "X pipeline: failure messages grouped (2 days)", """
        select left(error_message, 100), count(*), max(created_at)
        from pipeline_runs
        where created_at > now() - interval '2 days' and outcome = 'failed'
        group by 1 order by 2 desc limit 15
    """)

    print_rows(cur, "Satire gate: presence per deployed commit (last day)", """
        select commit_sha, count(*),
               count(*) filter (where logs->'note_prefilter_steps' ? 'satire_detector'),
               min(created_at), max(created_at)
        from pipeline_runs
        where created_at > now() - interval '1 day'
        group by 1 order by 4
    """)

    print_rows(cur, "Satire gate: firings and their reasoning (1 day)", """
        select tweet_id, left(coalesce(logs->'note_prefilter_steps'->>'reasoning',
                                       logs->'note_prefilter_steps'->'verdict'->>'reasoning'), 200)
        from pipeline_runs
        where created_at > now() - interval '1 day'
          and logs->'note_prefilter_steps' ? 'satire_detector'
          and (logs->'note_prefilter_steps'->>'reasoning' like 'overt satire%'
               or logs->'note_prefilter_steps'->'verdict'->>'reasoning' like 'overt satire%')
    """)

    print_rows(cur, "Everything pipeline: outcomes and cost per day (7 days)", """
        select created_at::date, outcome, count(*), round(sum(cost)::numeric, 2)
        from everything_pipeline_runs
        where created_at > now() - interval '7 days'
        group by 1, 2 order by 1 desc, 2
    """)

    print_rows(cur, "Everything items: status counts", """
        select status, checked_scope, count(*)
        from everything_items group by 1, 2 order by 3 desc
    """)

    print_rows(cur, "Everything items: error families", """
        select left(error, 45), count(*), min(created_at)::date, max(created_at)::date,
               count(*) filter (where priority > 0)
        from everything_items where status = 'error'
        group by 1 order by 2 desc
    """)

    print_rows(cur, "Everything items: transcript errors per project", """
        select p.slug, count(*), max(i.created_at)::date
        from everything_items i left join everything_projects p on p.id = i.project_id
        where i.status = 'error' and i.error like 'No en transcript%'
        group by 1 order by 2 desc
    """)

    print_rows(cur, "Reader note requests: status counts", """
        select status, count(*) from everything_note_requests group by 1
    """)

    print_rows(cur, "Reader note requests stuck 'enqueued' vs their item's state", """
        select r.created_at::date, i.status, left(i.error, 60), left(r.page_url, 60)
        from everything_note_requests r
        left join everything_items i on i.id = r.item_id
        where r.status = 'enqueued' order by r.created_at desc
    """)

    print_rows(cur, "Follow requests: status counts", """
        select status, count(*) from everything_follow_requests group by 1
    """)

    conn.close()


if __name__ == "__main__":
    main()
