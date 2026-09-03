# /// script
# requires-python = ">=3.11"
# dependencies = ["psycopg2-binary", "python-dotenv"]
# ///
"""Counts how many Serper credits the pipeline would have spent per day.

Two things hit the search backend:
1. The note-needed prefilter: one search per query in the query writer's final
   list (logged at note_prefilter_steps.query_writer.messages.1.content.queries).
2. The bot's tool-calling search loop (the kimi/glm arms): one search per
   google_search tool call (logged under note_writer_steps.search.turn.N).

We count both over the last 7 days of pipeline_runs. Everything runs on one
server-side aggregate query, so no log blobs cross the wire.
"""

import os

import psycopg2
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

SQL = """
with per_run as (
  select
    created_at::date as day,
    coalesce(jsonb_array_length(
      logs #> '{note_prefilter_steps,query_writer,messages,1,content,queries}'
    ), 0) as prefilter_queries,
    (logs #> '{note_prefilter_steps}') is not null as prefiltered,
    coalesce((
      select count(*)
      from jsonb_each(logs #> '{note_writer_steps,search,turn}') as t(turn_no, calls)
      cross join lateral jsonb_object_keys(calls) as k
      where k like 'google_search%'
        and jsonb_typeof(logs #> '{note_writer_steps,search,turn}') = 'object'
    ), 0) as loop_searches
  from pipeline_runs
  where created_at >= now() - interval '7 days'
)
select
  day,
  count(*) as runs,
  count(*) filter (where prefiltered) as prefiltered_runs,
  sum(prefilter_queries) as prefilter_searches,
  count(*) filter (where loop_searches > 0) as loop_runs,
  sum(loop_searches) as loop_searches,
  sum(prefilter_queries) + sum(loop_searches) as total_searches
from per_run
group by day
order by day;
"""

with psycopg2.connect(os.environ["PROD_DB_URL"]) as conn, conn.cursor() as cur:
    cur.execute(SQL)
    rows = cur.fetchall()

print(f"{'day':<12}{'rows':>6}{'prefiltered':>12}{'pf-searches':>12}{'loop-runs':>10}{'loop-searches':>14}{'total':>8}")
for day, runs, pf_runs, pf_q, loop_runs, loop_q, total in rows:
    print(f"{day!s:<12}{runs:>6}{pf_runs:>12}{pf_q:>12}{loop_runs:>10}{loop_q:>14}{total:>8}")

full_days = rows[1:-1] if len(rows) > 2 else rows
avg = sum(r[6] for r in full_days) / len(full_days)
print(f"\naverage total searches per full day: {avg:.0f}")
