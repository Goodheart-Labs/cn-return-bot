-- 099: a failed attempt that spent nothing does not hold the next feed post
-- back.
--
-- The pacing (migration 096) measures its interval from the start of the last
-- feed-tier item. That included an item whose fetch failed, for example a
-- YouTube video with no transcript, so a failed attempt of a few minutes was
-- followed by a full interval of waiting although no money was spent. Jim's
-- rule (2026-09-15): such an attempt counts as a run that spent nothing, so
-- it must not move the marker. The marker now ignores items in error. An item
-- that is done, or that was put back in the queue after spending part of its
-- budget, still moves it. Errored items were never part of the mean, and that
-- stays as it is.
--
-- Everything else in the function is unchanged from migration 096.

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
    select id, processed_at
    from everything_items
    where status = 'done'
      and checked_scope = 'page'
      and priority < 2
      and processed_at >= greatest(now() - make_interval(hours => fallback_hours), not_before)
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
    (select max(started_at) from everything_items where priority < 2 and status <> 'error')
  from chosen;
$$;

comment on function everything_feed_pacing(int, int, int, timestamptz) is
  'One snapshot of everything the feed pacing needs: the database clock, today''s spend, the mean cost of a finished feed post over the recent window (or the fallback window when the recent one holds fewer than min_posts), never counting a post finished before not_before, and when the last feed-tier item that is not in error started. Service role only.';
