-- 092: the Common Notes dashboard's metric series and pipeline funnel, plus
-- the extension's daily heartbeat (GOO-98).
--
-- 1. extension_active: a heartbeat the extension's background sends once per
--    install per UTC calendar day, whenever the browser is running. It is the
--    only way to count installs that are alive, because every other extension
--    event needs the reader to open a page with notes. Sent from
--    src/everything-extension/utils/analytics.ts (trackDailyActivity).
-- 2. everything_metric_series: the dashboard's line graph. One row per day,
--    week or month, over all time, holding every metric side by side.
-- 3. everything_pipeline_daily: what the pipeline yielded per day, for the
--    funnel under a draggable time window. The browser sums the days.
--
-- Both functions return aggregates only. The people metrics come back as a
-- histogram of "how many people did this exactly k times", so a device id or
-- account id never leaves the database. Whether a note is rated helpful is
-- NOT computed here. That rule is noteStatus() in
-- src/everything-shared/noteScore.ts, and the pipeline function hands the
-- browser the vote tallies it needs to apply it.

-- ---------------------------------------------------------------------------
-- 1. The heartbeat joins the event whitelist. The check was created inline on
--    the column in 077, so it carries Postgres's default name. This is the
--    same move 091 made for everything_pipeline_runs.

alter table everything_events
  drop constraint everything_events_event_check;

alter table everything_events
  add constraint everything_events_event_check check (event in (
    'pageview',
    'notes_shown',
    'extension_installed',
    'extension_active',
    'sign_in_started',
    'signed_in',
    'vote_gated_login',
    'write_note_teaser_shown',
    'improvement_write_rejected',
    'note_write_rejected'));

-- The series below reads two event names over all time, and 077 only indexed
-- created_at. Pageviews are most of the table, so an index led by the event
-- name keeps those reads from scanning every pageview.
create index if not exists everything_events_event_created_at
  on everything_events (event, created_at);

-- ---------------------------------------------------------------------------
-- 2. The metric series. One row per bucket from the first recorded row in any
--    source to today, in UTC. Weeks start on Monday, as date_trunc defines
--    them. Every metric is null in the buckets before its own source began
--    recording and 0 after that, so a line graph can tell "not recorded yet"
--    from "nobody". This is the per-metric form of the clamp migration 080
--    applies to the reader funnel.
--
--    active_devices  extension installs that sent the daily heartbeat.
--    note_viewers    histogram: devices by how many pages showed them notes
--                    (notes_shown events).
--    notes_seen      the notes on those pages, summed from the event's
--                    note_count.
--    voters          histogram: accounts by how many votes they cast.
--    votes           those votes. Both leave out the vote the 058 trigger
--                    casts for an author on their own note. It is automatic
--                    and says nothing about the person.
--    writers         histogram: accounts by how many notes they wrote,
--                    improvements included.
--    notes_written   those notes.
--
--    A histogram is a jsonb object like {"1": 40, "2": 9, "20": 1}: how many
--    people did the thing exactly k times in the bucket. Twenty means twenty
--    or more, because the dashboard's slider stops there (HISTOGRAM_CAP in
--    src/analytics-dashboard/src/lib/queries.ts). "At least n" is the sum
--    over the keys >= n.
--
--    The function is plpgsql because a wrong granularity has to be refused
--    with a message, and a language sql function cannot raise. In plpgsql the
--    output columns are variables in scope, so every internal column carries
--    a different name (b, who, hist, n) and the final select qualifies each
--    reference. Otherwise Postgres reports "column reference is ambiguous".

create or replace function everything_metric_series(granularity text default 'day')
returns table (
  bucket date,
  active_devices bigint,
  note_viewers jsonb,
  notes_seen bigint,
  voters jsonb,
  votes bigint,
  writers jsonb,
  notes_written bigint
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
    case when cal.b >= era.first_note then coalesce(wc.n, 0)::bigint end
  from calendar cal
  cross join era
  left join device_count dc on dc.b = cal.b
  left join viewer_hist vh on vh.b = cal.b
  left join seen_sum ss on ss.b = cal.b
  left join voter_hist oh on oh.b = cal.b
  left join vote_count vc on vc.b = cal.b
  left join writer_hist wh on wh.b = cal.b
  left join written_count wc on wc.b = cal.b
  order by cal.b;
end
$$;

comment on function everything_metric_series(text) is
  'One row per day, week or month (UTC), all time, for the dashboard line graph. People metrics are histograms {"k": people who did it exactly k times}, capped at 20. Null before a source started recording, 0 after.';

-- 050 revoked default function privileges, so grant execute back explicitly.
revoke all on function everything_metric_series(text) from public;
grant execute on function everything_metric_series(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The pipeline funnel, one row per UTC day from the first finished post to
--    today. A day's row holds the posts the pipeline FINISHED that day
--    (processed_at, stamped by markItemDone in src/everything/db.ts) and what
--    those exact posts yielded, whenever that happened. So the stages form a
--    cohort and always shrink left to right, and the browser can sum any
--    range of days for the funnel.
--
--    items_processed  finished whole-page or paragraph checks. checked_scope
--                     is null on a row a reader's note created without any
--                     pipeline run (migration 081), and an errored item also
--                     carries a processed_at, so both are filtered out.
--    claims_extracted claims the pipeline extracted from those posts
--                     (created_by null; a reader writing a note creates a
--                     claim of their own).
--    claims_checked   the claims among those that went through a fact-check:
--                     note, no_note or error. A skipped claim was rated
--                     confidently true and never checked.
--    ai_note_tallies  the notes the pipeline wrote on those claims
--                     (author_id null), grouped by vote tally: a jsonb array
--                     of {helpful_count, somewhat_helpful_count,
--                     not_helpful_count, notes}. The browser sums notes for
--                     the fourth bar and, for the fifth, sums the tallies
--                     noteStatus() calls helpful. Hidden notes are withdrawn
--                     and left out.

-- The claims table is wide (each row carries the claim's text and its context
-- passage), and reading all of it took five seconds on the production disk,
-- past the statement timeout PostgREST gives the anon role. This index holds
-- exactly the columns the function needs, so the planner answers from the
-- index alone and never touches the heap.
create index if not exists everything_claims_pipeline_item_status
  on everything_claims (item_id, status)
  where created_by is null;

create or replace function everything_pipeline_daily()
returns table (
  day date,
  items_processed bigint,
  claims_extracted bigint,
  claims_checked bigint,
  ai_note_tallies jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with cohort as (
    select i.id, (i.processed_at at time zone 'utc')::date as d
    from everything_items i
    where i.status = 'done'
      and i.checked_scope is not null
      and i.processed_at is not null
  ),
  extracted as (
    select c.id, c.status, cohort.d
    from everything_claims c
    join cohort on cohort.id = c.item_id
    where c.created_by is null
  ),
  ai_note as (
    select extracted.d, nt.helpful_count, nt.somewhat_helpful_count, nt.not_helpful_count
    from everything_notes nt
    join extracted on extracted.id = nt.claim_id
    where nt.author_id is null
      and nt.status <> 'hidden'
  ),
  item_count as (
    select d, count(*) as n from cohort group by d
  ),
  claim_count as (
    select d, count(*) as n, count(*) filter (where status in ('note', 'no_note', 'error')) as checked
    from extracted group by d
  ),
  tally as (
    select d, jsonb_agg(jsonb_build_object(
      'helpful_count', helpful_count,
      'somewhat_helpful_count', somewhat_helpful_count,
      'not_helpful_count', not_helpful_count,
      'notes', notes)) as tallies
    from (
      select d, helpful_count, somewhat_helpful_count, not_helpful_count, count(*) as notes
      from ai_note
      group by d, helpful_count, somewhat_helpful_count, not_helpful_count
    ) grouped
    group by d
  ),
  calendar as (
    select generate_series(
      (select min(d) from cohort)::timestamp,
      (now() at time zone 'utc')::date::timestamp,
      interval '1 day'
    )::date as d
  )
  select
    cal.d,
    coalesce(ic.n, 0),
    coalesce(cc.n, 0),
    coalesce(cc.checked, 0),
    coalesce(t.tallies, '[]'::jsonb)
  from calendar cal
  left join item_count ic on ic.d = cal.d
  left join claim_count cc on cc.d = cal.d
  left join tally t on t.d = cal.d
  order by cal.d
$$;

comment on function everything_pipeline_daily() is
  'One row per UTC day from the first finished post to today: posts the pipeline finished that day and, as a cohort, the claims extracted from them, the claims checked, and the AI notes written on them grouped by vote tally. Rated-helpful is decided client-side with noteStatus().';

revoke all on function everything_pipeline_daily() from public;
grant execute on function everything_pipeline_daily() to anon, authenticated;
