# /// script
# requires-python = ">=3.11"
# dependencies = ["psycopg2-binary", "python-dotenv"]
# ///
"""Compares the prefilter's pass rate before and after the Serper swap.

The August 2026 incident showed up as the prefilter rejecting almost everything
because search went blind. So the number to watch is the share of prefiltered
posts where the prefilter said "needs note", plus the share of prefilter runs
whose search came back with zero results (which triggers the fail-open path).
"""

import os

import psycopg2
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

SERPER_MERGED_AT = "2026-09-03 15:46:54+00"

SQL = f"""
with prefiltered as (
  select
    created_at,
    created_at >= timestamptz '{SERPER_MERGED_AT}' as after_serper,
    (logs #>> '{{note_prefilter_steps,verdict,needsNote}}')::boolean as needs_note,
    coalesce((logs #>> '{{note_prefilter_steps,fetch_and_format_search,resultCount}}')::int, -1) as result_count,
    coalesce(jsonb_array_length(
      logs #> '{{note_prefilter_steps,query_writer,messages,1,content,queries}}'
    ), 0) as queries
  from pipeline_runs
  where created_at >= now() - interval '7 days'
    and (logs #> '{{note_prefilter_steps,verdict}}') is not null
)
select
  after_serper,
  count(*) as prefiltered_posts,
  count(*) filter (where needs_note) as passed,
  round(100.0 * count(*) filter (where needs_note) / count(*), 1) as pass_pct,
  count(*) filter (where queries > 0) as searched,
  count(*) filter (where queries > 0 and result_count = 0) as zero_result_searches,
  round(avg(result_count) filter (where result_count > 0), 1) as avg_results
from prefiltered
group by after_serper
order by after_serper;
"""

with psycopg2.connect(os.environ["PROD_DB_URL"]) as conn, conn.cursor() as cur:
    cur.execute(SQL)
    rows = cur.fetchall()

print(f"{'period':<16}{'posts':>7}{'passed':>8}{'pass%':>8}{'searched':>10}{'0-result':>10}{'avg results':>13}")
for after, posts, passed, pct, searched, zero, avg in rows:
    label = "after Serper" if after else "before (SearXNG)"
    print(f"{label:<16}{posts:>7}{passed:>8}{pct!s:>8}{searched:>10}{zero:>10}{avg!s:>13}")
