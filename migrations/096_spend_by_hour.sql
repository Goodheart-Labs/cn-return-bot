-- 096: spend per UTC hour, for the dashboard's "Spend by hour" chart.
--
-- The feed pacing (migration 095) spreads the day's budget across the UTC
-- day. Whether it does is easiest to see as one bar per hour over the last
-- week: a paced day is a low flat row, the old pattern one tall bar after
-- midnight. This is the first anon-callable read of everything_pipeline_runs,
-- which has row security on and no policies and holds full prompts in its
-- logs column, so the function is security definer and returns aggregates
-- only. Empty hours come back as rows with zero, so a chart shows a gap rather
-- than squeezing it away, the same rule the metric series of 092 follows.

create or replace function everything_spend_by_hour(window_days int default 7)
returns table (hour timestamptz, cost numeric, runs bigint)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select
      date_trunc('hour', now() at time zone 'utc') at time zone 'utc' - make_interval(days => window_days) + interval '1 hour' as first_hour,
      date_trunc('hour', now() at time zone 'utc') at time zone 'utc' as last_hour
  ),
  hours as (
    select generate_series(first_hour, last_hour, interval '1 hour') as hour from bounds
  ),
  spent as (
    select date_trunc('hour', r.created_at at time zone 'utc') at time zone 'utc' as hour,
           sum(r.cost) as cost,
           count(*) as runs
    from everything_pipeline_runs r, bounds
    where r.created_at >= bounds.first_hour
    group by 1
  )
  select h.hour, coalesce(s.cost, 0), coalesce(s.runs, 0)
  from hours h
  left join spent s on s.hour = h.hour
  order by h.hour;
$$;

comment on function everything_spend_by_hour(int) is
  'LLM spend of the everything pipeline per UTC hour over the last window_days, ending with the current hour, every hour present. cost is the summed everything_pipeline_runs.cost, runs how many stage rows (checks, extractions, ratings) were written. Aggregates only; readable by anon for the dashboard.';

-- 050 revoked default function privileges, so grant execute back explicitly.
revoke all on function everything_spend_by_hour(int) from public;
grant execute on function everything_spend_by_hour(int) to anon, authenticated;
