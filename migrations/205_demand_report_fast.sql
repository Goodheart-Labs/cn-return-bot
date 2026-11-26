-- everything_demand_report in one pass over the posts, so it finishes in under
-- a second again.
--
-- Migration 183 looked up each queued page's item with a lateral subquery,
-- which reads every row of everything_items once per queued page. With 137
-- pages queued in 9 days and 9,578 items (cn-walk added 3,300 since
-- 2026-11-19) it took 36 seconds on 2026-11-25; service_role's statement
-- timeout is 30 seconds. cn-walk calls it first in queueDemandedPages, so
-- since 2026-11-22 18:15 UTC every tidy pass failed there: no page readers
-- opened was queued (32 waited on 2026-11-25) and no post that could not be
-- read got its repeat attempts (74 videos stayed in error), because
-- retryUnreadPosts runs after it.
--
-- Same answer as before, measured on production: 0.4 seconds.
-- To undo, run the function's definition from migration 183 again.
create or replace function everything_demand_report()
returns table (kind text, queued_24h int, settled int, checked int, with_notes int)
language sql stable set search_path = public as $$
  with q as (
    select d.page_url, d.kind, d.queued_at
      from everything_demand_queued d
     where d.queued and d.queued_at > now() - interval '9 days'
  ),
  -- One item per page, so a page stored under two spellings counts once.
  i as (
    select distinct on (page_url) everything_visit_page(it.url) as page_url, it.id, it.status
      from everything_items it
     where everything_visit_page(it.url) in (select q.page_url from q)
     order by page_url, it.created_at
  )
  select q.kind,
         count(*) filter (where q.queued_at > now() - interval '24 hours')::int,
         count(*) filter (where q.queued_at <= now() - interval '2 days')::int,
         count(*) filter (where q.queued_at <= now() - interval '2 days' and i.status = 'done')::int,
         count(*) filter (where q.queued_at <= now() - interval '2 days' and exists (
           select 1 from everything_claims c join everything_notes n on n.claim_id = c.id where c.item_id = i.id))::int
    from q left join i on i.page_url = q.page_url
   group by q.kind;
$$;
