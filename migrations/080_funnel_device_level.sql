-- Rebuild the analytics funnel so every stage counts the same thing over the
-- same period (GOO-48). The old funnel mixed devices, accounts, and voters
-- from two tables with different histories, which produced impossible shapes
-- like more voters than signed-in users.
--
-- Two changes, both from Jim's design:
--
-- 1. The funnel's timeframe never starts before the first event row. Event
--    recording began on 2026-08-17, but votes reach back to July. A window
--    that opens before the first event compares a populated votes table
--    against an empty events table, so the clamp keeps both sources on the
--    same period.
--
-- 2. Every stage counts distinct devices. A vote row carries no device, only
--    the voter's account, so each vote is mapped to a device through that
--    account's event rows: the event on the vote's platform nearest in time
--    to the vote wins, and ties are broken at random. A vote whose voter has
--    no event rows at all cannot be mapped and is left out of the funnel
--    (today there are no such votes inside the event era).
--
-- The extension funnel now starts at "devices seen" (any extension event)
-- instead of installs. The extension_installed event misses most real
-- installs, because dev builds and installs from before the event existed
-- never fired it, and gating on it undercounted every later stage.

create or replace function everything_funnel(window_days int default null)
returns table (platform text, stage text, users bigint)
language sql security definer set search_path = public as $$
  with era as (
    select min(created_at) as t0 from everything_events
  ),
  cutoff as (
    select greatest(
      coalesce((select t0 from era), now()),
      case when window_days is null then '-infinity'::timestamptz
           else now() - make_interval(days => window_days) end
    ) as t
  ),
  vote_devices as (
    select distinct on (v.id)
      coalesce(v.platform, e.platform) as platform,
      e.device_id
    from everything_votes v
    cross join cutoff
    join everything_events e
      on e.user_id = v.voter_id
     and (v.platform is null or e.platform = v.platform)
    where v.created_at >= cutoff.t
    order by v.id, abs(extract(epoch from (e.created_at - v.created_at))), random()
  ),
  device_votes as (
    select vd.platform, vd.device_id, count(*) as n
    from vote_devices vd
    group by 1, 2
  )
  select 'web', 'visitors', count(distinct e.device_id)
    from everything_events e, cutoff
    where e.event = 'pageview' and e.created_at >= cutoff.t
  union all
  select 'extension', 'devices', count(distinct e.device_id)
    from everything_events e, cutoff
    where e.platform = 'extension' and e.created_at >= cutoff.t
  union all
  select 'extension', 'shown_notes', count(distinct e.device_id)
    from everything_events e, cutoff
    where e.event = 'notes_shown' and e.created_at >= cutoff.t
  union all
  select e.platform, 'signed_in', count(distinct e.device_id)
    from everything_events e, cutoff
    where e.user_id is not null and e.created_at >= cutoff.t
    group by e.platform
  union all select dv.platform, 'voted_1',  count(*) from device_votes dv where n >= 1  group by dv.platform
  union all select dv.platform, 'voted_5',  count(*) from device_votes dv where n >= 5  group by dv.platform
  union all select dv.platform, 'voted_10', count(*) from device_votes dv where n >= 10 group by dv.platform
$$;
