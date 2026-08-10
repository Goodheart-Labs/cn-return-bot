-- 073: Supabase-native analytics, replacing PostHog.
--
-- everything_events holds only the events the database is otherwise blind to
-- (anonymous visits, extension exposure, abandoned sign-in/vote intents,
-- judge rejections). Facts a domain table already records — votes, notes,
-- sign-up timestamps — are never duplicated here; the funnel RPC below reads
-- them from their own tables.
--
-- Clients can only insert (the 066 note-requests pattern): there is no select
-- policy, so the anon key can never read events back. The dashboard reads
-- through the two security-definer aggregate RPCs at the bottom, which return
-- only counts.

create table everything_events (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event      text not null check (event in (
    'pageview',
    'notes_shown',
    'extension_installed',
    'sign_in_started',
    'signed_in',
    'vote_gated_login',
    'write_note_teaser_shown',
    'improvement_write_rejected',
    'note_write_rejected')),
  platform   text not null check (platform in ('web', 'extension')),
  -- A random id minted by the client (localStorage on the web, extension
  -- storage in the extension). Re-minted on sign-out.
  device_id  uuid not null,
  -- Set on every event that happens while signed in. Together with device_id
  -- this stores the device-to-user link, so a per-person conversion funnel
  -- stays possible later even though today's dashboard only shows stage counts.
  -- On user deletion the event degrades to anonymous instead of blocking.
  user_id    uuid references auth.users (id) on delete set null,
  props      jsonb not null default '{}' check (pg_column_size(props) <= 2048)
);

create index everything_events_created_at on everything_events (created_at);

alter table everything_events enable row level security;
grant insert on everything_events to anon, authenticated;
create policy events_insert on everything_events
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

-- Funnel stage counts, split by platform, optionally restricted to the last
-- window_days days (null means all time). Every stage is counted
-- independently within the window — this is not a per-person conversion
-- funnel:
--   visitors  = distinct devices that saw content (web pageview, or notes
--               actually shown by the extension — the extension has no
--               pageview concept).
--   signed_in = distinct users who did anything while signed in. Users who
--               signed up before this table existed appear once they are
--               next active, consistent with the visitors stage.
--   voted_N   = voters whose vote count in the window reaches N. The primary
--               key of everything_votes is (note_id, voter_id), so count(*)
--               per voter is exactly "distinct notes voted". Votes from
--               before migration 069 have no platform and are reported under
--               'unknown' rather than guessed. A user who votes on both
--               platforms counts in each platform where they independently
--               reach the tier.
create or replace function everything_funnel(window_days int default null)
returns table (platform text, stage text, users bigint)
language sql security definer set search_path = public as $$
  with cutoff as (
    select case when window_days is null then '-infinity'::timestamptz
                else now() - make_interval(days => window_days) end as t
  ),
  votes as (
    select coalesce(v.platform, 'unknown') as platform, v.voter_id, count(*) as n
    from everything_votes v, cutoff
    where v.created_at >= cutoff.t
    group by 1, 2
  )
  select e.platform, 'visitors', count(distinct e.device_id)
    from everything_events e, cutoff
    where e.event in ('pageview', 'notes_shown') and e.created_at >= cutoff.t
    group by e.platform
  union all
  select e.platform, 'signed_in', count(distinct e.user_id)
    from everything_events e, cutoff
    where e.user_id is not null and e.created_at >= cutoff.t
    group by e.platform
  union all select v.platform, 'voted_1',  count(*) from votes v where n >= 1  group by v.platform
  union all select v.platform, 'voted_5',  count(*) from votes v where n >= 5  group by v.platform
  union all select v.platform, 'voted_10', count(*) from votes v where n >= 10 group by v.platform
$$;

-- 050 revoked default function privileges, so grant execute back explicitly.
revoke all on function everything_funnel(int) from public;
grant execute on function everything_funnel(int) to anon, authenticated;

-- Daily activity for the dashboard's time-series chart: pageviews and
-- notes-shown per day and platform.
create or replace function everything_daily_activity(window_days int default 30)
returns table (day date, platform text, event text, events bigint)
language sql security definer set search_path = public as $$
  select e.created_at::date, e.platform, e.event, count(*)
  from everything_events e
  where e.event in ('pageview', 'notes_shown')
    and e.created_at >= now() - make_interval(days => window_days)
  group by 1, 2, 3
  order by 1
$$;

revoke all on function everything_daily_activity(int) from public;
grant execute on function everything_daily_activity(int) to anon, authenticated;
