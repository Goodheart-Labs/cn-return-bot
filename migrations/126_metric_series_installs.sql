-- 126: the dashboard's line graph can plot new extension installs (GOO-487).
--
-- The extension writes an extension_installed event once, when the browser
-- first installs it. The new column installs counts the different devices
-- that sent one in the bucket. Development installs are left out the same way
-- as in migration 116: since version 0.4.1 an unpacked build reports
-- install_type "development", and those are our own test browsers. A reader
-- who removes the extension and installs it again gets a new device id, so
-- the reinstall counts as a new install.
--
-- The function returns one more column than before, and Postgres cannot change
-- a function's result columns in place, so it is dropped and created again.
-- Apart from the installs column it is the function from migration 116.

drop function everything_metric_series(text);

create function everything_metric_series(granularity text default 'day')
returns table (
  bucket date,
  active_devices bigint,
  note_viewers jsonb,
  notes_seen bigint,
  voters jsonb,
  votes bigint,
  writers jsonb,
  notes_written bigint,
  installs bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if granularity not in ('day', 'week', 'month') then
    raise exception 'granularity must be day, week or month, not %', granularity;
  end if;

  return query
  with
  heartbeat as (
    select date_trunc(granularity, e.created_at at time zone 'utc')::date as b, e.device_id as who
    from everything_events e
    where e.event = 'extension_active'
      and e.props ->> 'install_type' is distinct from 'development'
  ),
  installed as (
    select date_trunc(granularity, e.created_at at time zone 'utc')::date as b, e.device_id as who
    from everything_events e
    where e.event = 'extension_installed'
      and e.props ->> 'install_type' is distinct from 'development'
  ),
  shown as (
    select
      date_trunc(granularity, e.created_at at time zone 'utc')::date as b,
      e.device_id as who,
      -- props is written by the client. A missing or non-numeric note_count
      -- counts as none rather than breaking the whole series.
      case when jsonb_typeof(e.props -> 'note_count') = 'number'
           then greatest((e.props ->> 'note_count')::numeric, 0)
           else 0 end as note_count
    from everything_events e
    where e.event = 'notes_shown'
      and e.props ->> 'install_type' is distinct from 'development'
  ),
  vote as (
    select date_trunc(granularity, v.created_at at time zone 'utc')::date as b, v.voter_id as who
    from everything_votes v
    join everything_notes nt on nt.id = v.note_id
    where v.voter_id is distinct from nt.author_id
  ),
  written as (
    select date_trunc(granularity, nt.created_at at time zone 'utc')::date as b, nt.author_id as who
    from everything_notes nt
    where nt.author_id is not null
      and nt.status <> 'hidden'
  ),
  viewer_times as (
    select s.b, least(count(*), 20) as times from shown s group by s.b, s.who
  ),
  voter_times as (
    select v.b, least(count(*), 20) as times from vote v group by v.b, v.who
  ),
  writer_times as (
    select w.b, least(count(*), 20) as times from written w group by w.b, w.who
  ),
  viewer_hist as (
    select t.b, jsonb_object_agg(t.times::text, t.people) as hist
    from (select vt.b, vt.times, count(*) as people from viewer_times vt group by vt.b, vt.times) t
    group by t.b
  ),
  voter_hist as (
    select t.b, jsonb_object_agg(t.times::text, t.people) as hist
    from (select vt.b, vt.times, count(*) as people from voter_times vt group by vt.b, vt.times) t
    group by t.b
  ),
  writer_hist as (
    select t.b, jsonb_object_agg(t.times::text, t.people) as hist
    from (select wt.b, wt.times, count(*) as people from writer_times wt group by wt.b, wt.times) t
    group by t.b
  ),
  device_count as (
    select h.b, count(distinct h.who) as n from heartbeat h group by h.b
  ),
  install_count as (
    select i.b, count(distinct i.who) as n from installed i group by i.b
  ),
  seen_sum as (
    select s.b, sum(s.note_count)::bigint as n from shown s group by s.b
  ),
  vote_count as (
    select v.b, count(*) as n from vote v group by v.b
  ),
  written_count as (
    select w.b, count(*) as n from written w group by w.b
  ),
  -- Where each source's record begins. The heartbeat is a new event, so its
  -- era starts at its own first row. The other three start at their table's
  -- first row, before which nothing was being recorded at all.
  era as (
    select
      (select min(h.b) from heartbeat h) as first_heartbeat,
      (select date_trunc(granularity, min(e.created_at) at time zone 'utc')::date from everything_events e) as first_event,
      (select date_trunc(granularity, min(v.created_at) at time zone 'utc')::date from everything_votes v) as first_vote,
      (select date_trunc(granularity, min(nt.created_at) at time zone 'utc')::date from everything_notes nt) as first_note
  ),
  -- least() skips nulls. An empty database gives a null start, which
  -- generate_series turns into no rows.
  calendar as (
    select generate_series(
      least(era.first_heartbeat, era.first_event, era.first_vote, era.first_note)::timestamp,
      date_trunc(granularity, now() at time zone 'utc'),
      ('1 ' || granularity)::interval
    )::date as b
    from era
  )
  select
    cal.b,
    case when cal.b >= era.first_heartbeat then coalesce(dc.n, 0)::bigint end,
    case when cal.b >= era.first_event then coalesce(vh.hist, '{}'::jsonb) end,
    case when cal.b >= era.first_event then coalesce(ss.n, 0)::bigint end,
    case when cal.b >= era.first_vote then coalesce(oh.hist, '{}'::jsonb) end,
    case when cal.b >= era.first_vote then coalesce(vc.n, 0)::bigint end,
    case when cal.b >= era.first_note then coalesce(wh.hist, '{}'::jsonb) end,
    case when cal.b >= era.first_note then coalesce(wc.n, 0)::bigint end,
    case when cal.b >= era.first_event then coalesce(ic.n, 0)::bigint end
  from calendar cal
  cross join era
  left join device_count dc on dc.b = cal.b
  left join viewer_hist vh on vh.b = cal.b
  left join seen_sum ss on ss.b = cal.b
  left join voter_hist oh on oh.b = cal.b
  left join vote_count vc on vc.b = cal.b
  left join writer_hist wh on wh.b = cal.b
  left join written_count wc on wc.b = cal.b
  left join install_count ic on ic.b = cal.b
  order by cal.b;
end
$$;

comment on function everything_metric_series(text) is
  'One row per day, week or month (UTC), all time, for the dashboard line graph. People metrics are histograms {"k": people who did it exactly k times}, capped at 20. Null before a source started recording, 0 after.';

-- 050 revoked default function privileges, so grant execute back explicitly.
revoke all on function everything_metric_series(text) from public;
grant execute on function everything_metric_series(text) to anon, authenticated;
