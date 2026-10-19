-- 125: a finished feed item that spent nothing does not hold the next feed
-- post back, and does not lower the mean post cost.
--
-- Migration 099 made the pacing marker ignore items in error, by Jim's rule of
-- 2026-09-15: an attempt that spent nothing must not delay the next post.
-- GOO-422 now finishes some items as done without spending anything. A
-- YouTube video without captions, or one shown only to signed-in adults, ends
-- as done with a skip_reason instead of failing. Without this change each
-- such video would delay the next feed post by a full interval, and its zero
-- cost would pull the mean down, which spaces the following posts too
-- closely.
--
-- "Spent nothing" means the item has no everything_pipeline_runs row of its
-- own. Every item that reached extraction has one, including an item the
-- intent gate declined, because the gate is part of extraction. So only items
-- that ended before any model call are left out.
--
-- Everything else in the function is unchanged from migration 099.

create or replace function everything_feed_pacing(window_hours int, min_posts int, fallback_hours int, not_before timestamptz)
returns table (
  db_now timestamptz,
  spent_today_usd numeric,
  mean_post_cost_usd numeric,
  sample_posts bigint,
  sample_hours int,
  last_feed_started_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with posts as (
    select i.id, i.processed_at
    from everything_items i
    where i.status = 'done'
      and i.checked_scope = 'page'
      and i.priority < 2
      and i.processed_at >= greatest(now() - make_interval(hours => fallback_hours), not_before)
      and exists (select 1 from everything_pipeline_runs r where r.item_id = i.id)
  ),
  cost_rows as (
    select r.item_id, r.cost
    from everything_pipeline_runs r
    join posts p on p.id = r.item_id
    union all
    select c.item_id, r.cost
    from everything_claims c
    join posts p on p.id = c.item_id
    join everything_pipeline_runs r on r.claim_id = c.id
  ),
  post_cost as (
    select p.id, p.processed_at, coalesce(sum(cr.cost), 0) as cost
    from posts p
    left join cost_rows cr on cr.item_id = p.id
    group by p.id, p.processed_at
  ),
  recent as (
    select count(*) as n, avg(cost) as mean
    from post_cost
    where processed_at >= now() - make_interval(hours => window_hours)
  ),
  wide as (
    select count(*) as n, avg(cost) as mean from post_cost
  ),
  chosen as (
    select
      case when recent.n >= min_posts then recent.mean else wide.mean end as mean,
      case when recent.n >= min_posts then recent.n else wide.n end as n,
      case when recent.n >= min_posts then window_hours else fallback_hours end as hours
    from recent, wide
  )
  select
    now(),
    (select coalesce(sum(cost), 0)
       from everything_pipeline_runs
      where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
    chosen.mean,
    chosen.n,
    chosen.hours,
    (select max(i.started_at)
       from everything_items i
      where i.priority < 2
        and i.status <> 'error'
        and (i.status <> 'done' or exists (select 1 from everything_pipeline_runs r where r.item_id = i.id)))
  from chosen;
$$;

comment on function everything_feed_pacing(int, int, int, timestamptz) is
  'One snapshot of everything the feed pacing needs: the database clock, today''s spend, the mean cost of a finished feed post over the recent window (or the fallback window when the recent one holds fewer than min_posts), never counting a post finished before not_before, and when the last feed-tier item that is not in error started. A finished item without a pipeline run of its own spent nothing and counts in neither. Service role only.';

comment on column everything_items.skip_reason is
  'Why this item was finished without being checked: the intent gate''s reason, or "no captions" or "age-restricted" for a YouTube video we cannot read. Null when it was checked.';
