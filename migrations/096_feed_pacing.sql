-- 096: pace feed posts across the UTC day instead of spending the budget in a
-- burst after midnight.
--
-- The Actions feed run now asks, before every post, whether enough time has
-- passed since the last feed post started. The interval is Jim's rule: the
-- hours left in the day, times the average cost of a recent post, divided by
-- the money left today. Every input of that rule comes from this one function,
-- read in one database snapshot, so the runner's clock is never compared with
-- the database's. Migration 093 states that rule for the X pipeline, and it
-- applies here for the same reason.
--
-- 1. everything_items.started_at: when an item last entered `processing`. A
--    trigger stamps it with database time, so neither worker has to change and
--    both stamp the same clock. It is also the first record of how long an
--    item took, next to processed_at.
-- 2. everything_feed_pacing: the snapshot. Today's spend, the mean cost of a
--    finished feed post over the recent window (or a wider one when the recent
--    window is too thin), and when the last feed post started.

-- ---------------------------------------------------------------------------
-- 1. When an item last started processing.

alter table everything_items add column started_at timestamptz;

comment on column everything_items.started_at is
  'When the item last entered processing. Stamped by a trigger with database time. The feed pacing measures its interval from the newest of these among feed-tier items; processed_at minus started_at is how long the last attempt took.';

create or replace function everything_items_stamp_started_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'processing' and old.status is distinct from 'processing' then
    new.started_at := now();
  end if;
  return new;
end;
$$;

create trigger everything_items_stamp_started_at
  before update of status on everything_items
  for each row execute function everything_items_stamp_started_at();

-- ---------------------------------------------------------------------------
-- 2. The pacing snapshot.
--
-- A "feed post" is an item below the requested tier (priority < 2) that
-- finished as a whole-page check. Pages readers asked for are left out: they
-- spend from the reserve, the intake service processes them outside the
-- pacing, and one of them was a 50 USD outlier. Errored items are left out
-- because an error before extraction cost nothing and would drag the mean
-- down. A post's cost is every cost row that belongs to it, whenever it was
-- written, so a post cut short one day and resumed the next counts its whole
-- cost. Cost rows attach two ways: extraction and rating rows carry item_id,
-- check rows carry claim_id and reach the item through everything_claims.
--
-- The mean is taken over the posts finished in the last window_hours when at
-- least min_posts of them exist, otherwise over the last fallback_hours. The
-- row says which window it used and how many posts it saw, so the run log can
-- print it. A mean of null means no finished post in either window; the
-- caller then uses its default.
--
-- spent_today_usd is the same sum everything_cost_since gives for the start of
-- the UTC day, computed here so it shares the snapshot's clock.

create or replace function everything_feed_pacing(window_hours int, min_posts int, fallback_hours int)
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
      and processed_at >= now() - make_interval(hours => fallback_hours)
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
    (select max(started_at) from everything_items where priority < 2)
  from chosen;
$$;

comment on function everything_feed_pacing(int, int, int) is
  'One snapshot of everything the feed pacing needs: the database clock, today''s spend, the mean cost of a finished feed post over the recent window (or the fallback window when the recent one holds fewer than min_posts), and when the last feed-tier item started. Service role only.';

-- Revoking public also strips service_role's inherited execute, so grant it
-- back explicitly. The pipeline is the only caller.
revoke execute on function everything_feed_pacing(int, int, int) from public, anon, authenticated;
grant execute on function everything_feed_pacing(int, int, int) to service_role;
