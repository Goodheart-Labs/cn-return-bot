# /// script
# requires-python = ">=3.10"
# dependencies = ["python-dotenv", "psycopg2-binary"]
# ///
"""GOO-57 step 2: quantify the failure classes and the spend picture.

Prints error items grouped by error class, daily pipeline spend for the last
14 days (shows which days hit the cap and roughly when), and the current
queue state.

Run from the workspace root:
  uv run src/scripts_jim/2026_08_30_feed_coverage/summary.py
"""

import os

import psycopg2
from dotenv import load_dotenv

load_dotenv()

conn = psycopg2.connect(os.environ["PROD_DB_URL"])
cur = conn.cursor()

print("=== error items by class ===")
cur.execute("""
  select case
      when error like '%%Key limit exceeded%%' then 'openrouter monthly key limit (403)'
      when error like '%%requires more credits%%' then 'openrouter out of credits (402)'
      when error like '%%No en transcript%%' then 'no english transcript'
      when error like '%%orphaned in processing%%' then 'orphaned before extraction'
      else coalesce(left(error, 60), '(no error text)')
    end as class,
    count(*), min(processed_at::date), max(processed_at::date)
  from everything_items where status = 'error'
  group by 1 order by 2 desc
""")
for row in cur.fetchall():
    print(f"  {row[1]:4}  {row[0]:50}  {row[2]} → {row[3]}")

print("\n=== items by status ===")
cur.execute("select status, count(*) from everything_items group by 1 order by 2 desc")
for row in cur.fetchall():
    print(f"  {row[1]:4}  {row[0]}")

print("\n=== queued right now (priority, created) ===")
cur.execute("""
  select i.priority, i.url, i.created_at::date, p.slug
  from everything_items i left join everything_projects p on p.id = i.project_id
  where i.status in ('queued', 'processing') order by i.priority desc, i.created_at
""")
for row in cur.fetchall():
    print(f"  prio {row[0]}  [{row[3]}] {row[2]}  {row[1][:80]}")

print("\n=== daily spend, last 14 days (UTC) ===")
cur.execute("""
  select created_at::date, round(sum(cost)::numeric, 2), count(*),
         max(created_at::time)
  from everything_pipeline_runs
  where created_at > now() - interval '14 days'
  group by 1 order by 1
""")
for row in cur.fetchall():
    print(f"  {row[0]}  ${row[1]:>7}  {row[2]:4} claim-runs  last run {row[3]}")

print("\n=== spend by project, last 7 days ===")
cur.execute("""
  select coalesce(p.slug, '(none)'), round(sum(r.cost)::numeric, 2), count(*)
  from everything_pipeline_runs r
  left join everything_claims c on c.id = r.claim_id
  left join everything_items i on i.id = c.item_id
  left join everything_projects p on p.id = i.project_id
  where r.created_at > now() - interval '7 days'
  group by 1 order by 2 desc
""")
for row in cur.fetchall():
    print(f"  ${row[1]:>7}  {row[2]:4} claim-runs  {row[0]}")

conn.close()
