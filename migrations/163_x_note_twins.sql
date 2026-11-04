-- Migration 163: one rating system for both notewriters (GOO-676).
--
-- Our team and our readers rate our X notes with the same Yes, Somewhat and
-- No votes as Common Notes, in the same table. A vote in everything_votes must
-- point at a row of everything_notes, so every X note we submitted gets a
-- twin there: one row that stands for the X note. The twin has the X note's
-- id in x_note_id and no claim. Every Common Notes page reaches its notes
-- through a claim and its post, so a twin never shows on one of them. The few
-- functions that read everything_notes without a claim skip twins explicitly.
--
-- 1. Twins: the column, the trigger that makes them, and the backfill.
-- 2. The functions of Common Notes that read notes without a claim.
-- 3. The X notewriter page's field row gets our votes, so the review page's
--    X tab can filter and sort by them.

-- 1. Twins.

alter table everything_notes add column x_note_id text unique references notes (note_id) on delete cascade;
alter table everything_notes alter column claim_id drop not null;
alter table everything_notes add constraint everything_notes_claim_or_x_note check ((claim_id is null) <> (x_note_id is null));

-- Makes the twin of an X note once the note has been submitted. The twin
-- counts as written when the X note was submitted, so the website's rule that
-- reveals the vote counts of old notes counts from then.
create function notes_create_twin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into everything_notes (x_note_id, note, created_at)
  values (new.note_id, coalesce(new.note_text, ''), new.submitted_at)
  on conflict (x_note_id) do nothing;
  return null;
end;
$$;

create trigger notes_create_twin after insert or update of submitted_at on notes
  for each row when (new.submitted_at is not null) execute function notes_create_twin();

insert into everything_notes (x_note_id, note, created_at)
select note_id, coalesce(note_text, ''), submitted_at from notes where submitted_at is not null
on conflict (x_note_id) do nothing;

-- 2. The Common Notes functions that read notes without going through a
-- claim. The feed's two functions get the condition "n.claim_id is not
-- null", and the metric series starts at the first Common Notes note, not at
-- the first X note. Votes on twins still count in the metric series and in
-- the raters' leaderboard, because rating an X note is rating work too.

CREATE OR REPLACE FUNCTION public.everything_feed_stream(p_scope everything_feed_scope, p_views everything_item_views, p_band text, p_key text, p_after jsonb, p_limit integer)
 RETURNS TABLE(id uuid, item_id uuid, key double precision[], content double precision[], views bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  key_column text := case p_key
    when 'helpful' then 'feed_helpful_key'
    when 'needs_ratings' then 'feed_needs_key'
    when 'best' then 'feed_best_key'
    when 'recent' then 'feed_recent_key'
  end;
  views_of constant text := 'coalesce(($2).viewers[array_position(($2).item_ids, n.feed_item_id)], 0)';
  conditions text[] := array['n.status <> ''hidden''', 'n.claim_id is not null'];
begin
  if key_column is null then raise exception 'Unknown sort key %', p_key; end if;
  if p_band is not null then conditions := conditions || 'n.feed_band = $3'::text; end if;
  if p_scope.project_id is not null then conditions := conditions || 'n.feed_project_id = ($1).project_id'::text; end if;
  if p_scope.item_id is not null then conditions := conditions || 'n.feed_item_id = ($1).item_id'::text; end if;
  if coalesce(p_scope.min_views, 0) > 0 then conditions := conditions || (views_of || ' >= ($1).min_views'); end if;
  if coalesce(p_scope.min_votes, 0) > 0 then conditions := conditions || 'n.feed_votes >= ($1).min_votes'::text; end if;
  if coalesce(p_scope.min_helpful, 0) > 0 then conditions := conditions || 'n.helpful_count >= ($1).min_helpful'::text; end if;
  if coalesce(p_scope.min_not_helpful, 0) > 0 then conditions := conditions || 'n.not_helpful_count >= ($1).min_not_helpful'::text; end if;
  -- A note the reader wrote counts as voted on, because posting a note casts a
  -- Helpful vote on it.
  if p_scope.unvoted_only then
    conditions := conditions || 'not exists (select 1 from everything_votes ev where ev.note_id = n.id and ev.voter_id = auth.uid() and ev.created_at < coalesce(($1).voted_before, now()))'::text;
  end if;
  if p_after is not null and p_after <> 'null'::jsonb then
    conditions := conditions || format(
      '(n.%I, n.feed_item_id, n.feed_content_key, n.id) > ('
      'array(select jsonb_array_elements_text($4 -> ''key'')::float8), ($4 ->> ''item_id'')::uuid, '
      'array(select jsonb_array_elements_text($4 -> ''content'')::float8), ($4 ->> ''id'')::uuid)', key_column);
  end if;
  return query execute format(
    'select n.id, n.feed_item_id, n.%1$I, n.feed_content_key, %2$s::bigint from everything_notes n where %3$s '
    'order by n.%1$I, n.feed_item_id, n.feed_content_key, n.id limit $5',
    key_column, views_of, array_to_string(conditions, ' and '))
  using p_scope, p_views, p_band, p_after, p_limit;
end;
$function$;

CREATE OR REPLACE FUNCTION public.everything_note_feed_summary(p_project_id uuid DEFAULT NULL::uuid, p_item_id uuid DEFAULT NULL::uuid, p_min_views integer DEFAULT 0, p_min_votes integer DEFAULT 0, p_min_helpful integer DEFAULT 0, p_min_not_helpful integer DEFAULT 0, p_unvoted_only boolean DEFAULT false, p_voted_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_since timestamp with time zone[] DEFAULT '{}'::timestamp with time zone[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  in_scope text[] := array['n.status <> ''hidden''', 'n.claim_id is not null'];
  passes text[] := array['true'];
  since_counts text[] := '{}';
  result jsonb;
begin
  if p_project_id is not null then in_scope := in_scope || 'n.feed_project_id = $1'::text; end if;
  if p_item_id is not null then in_scope := in_scope || 'n.feed_item_id = $2'::text; end if;
  if p_min_views > 0 then passes := passes || 'coalesce(iv.viewers, 0) >= $3'::text; end if;
  if p_min_votes > 0 then passes := passes || 'n.feed_votes >= $4'::text; end if;
  if p_min_helpful > 0 then passes := passes || 'n.helpful_count >= $5'::text; end if;
  if p_min_not_helpful > 0 then passes := passes || 'n.not_helpful_count >= $6'::text; end if;
  -- A note the reader wrote counts as voted on, because posting a note casts a
  -- Helpful vote on it.
  if p_unvoted_only then passes := passes || 'mine.note_id is null'::text; end if;
  for i in 1 .. coalesce(cardinality(p_since), 0) loop
    since_counts := since_counts || format('count(*) filter (where passes and created_at >= ($8)[%s])', i);
  end loop;
  execute format($query$
    with item_views as (
      select unnest(v.item_ids) as item_id, unnest(v.viewers) as viewers from everything_item_views() v
    ),
    mine as (
      select ev.note_id from everything_votes ev where ev.voter_id = auth.uid() and ev.created_at < coalesce($7, now())
    ),
    scoped as (
      select n.created_at, n.feed_band, n.feed_votes, n.helpful_count, n.not_helpful_count,
             coalesce(iv.viewers, 0) as views, (%1$s) as passes
        from everything_notes n
        left join item_views iv on iv.item_id = n.feed_item_id
        left join mine on mine.note_id = n.id
       where %2$s
    )
    select jsonb_build_object(
      'matching', count(*) filter (where passes),
      'bands', jsonb_build_object(
        'main', count(*) filter (where passes and feed_band in ('helpful', 'needs_ratings')),
        'unhelpful', count(*) filter (where passes and feed_band = 'not_helpful'),
        'stale', count(*) filter (where passes and feed_band = 'stale')),
      'since', jsonb_build_array(%3$s),
      'largest', jsonb_build_object(
        'views', coalesce(max(views), 0),
        'votes', coalesce(max(feed_votes), 0),
        'helpful', coalesce(max(helpful_count), 0),
        'not_helpful', coalesce(max(not_helpful_count), 0)))
    from scoped
  $query$, array_to_string(passes, ' and '), array_to_string(in_scope, ' and '), array_to_string(since_counts, ', '))
  into result
  using p_project_id, p_item_id, p_min_views, p_min_votes, p_min_helpful, p_min_not_helpful, p_voted_before, p_since;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.everything_metric_series(granularity text DEFAULT 'day'::text)
 RETURNS TABLE(bucket date, active_devices bigint, note_viewers jsonb, notes_seen bigint, voters jsonb, votes bigint, writers jsonb, notes_written bigint, installs bigint, installs_by_browser jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    select
      date_trunc(granularity, e.created_at at time zone 'utc')::date as b,
      e.device_id as who,
      coalesce(e.props ->> 'browser', 'unknown') as browser
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
  install_by_browser as (
    select t.b, jsonb_object_agg(t.browser, t.n) as by_browser
    from (select i.b, i.browser, count(distinct i.who) as n from installed i group by i.b, i.browser) t
    group by t.b
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
      (select date_trunc(granularity, min(nt.created_at) at time zone 'utc')::date from everything_notes nt where nt.claim_id is not null) as first_note
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
    case when cal.b >= era.first_event then coalesce(ic.n, 0)::bigint end,
    case when cal.b >= era.first_event then coalesce(ib.by_browser, '{}'::jsonb) end
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
  left join install_by_browser ib on ib.b = cal.b
  order by cal.b;
end
$function$;

-- 3. Our votes in the X notewriter page's field row.
--
-- The X notes gain five fields: our rating and our number of votes, which
-- describe the twin's public tally, the caller's own vote, and Jim's and
-- Nathan's votes. Those two are private, so they are filled in only for an
-- admin and are null for everyone else, which leaves nothing to filter by.
-- A vote is "helpful", "somewhat", "not_helpful" or "none", as on the review
-- page's Common Notes fields. On Common Notes all five are null, because the
-- dashboard does not use them.

alter type notewriter_field_row
  add attribute our_rating text,
  add attribute our_votes int,
  add attribute my_vote text,
  add attribute jim_vote text,
  add attribute nathan_vote text;

-- The twin of the note, so a card can show and take our votes.
alter type x_note_card add attribute twin_note_id uuid;

create or replace function notewriter_field_rows(p_source text, p_ids text[] default null) returns setof notewriter_field_row
language sql stable security definer set search_path = public as $$
  -- Materialized, so the default arms and the admin check are read once and
  -- not once per note.
  with fill as materialized (select x_fill_picks() as picks),
  admin as materialized (select everything_is_admin() as is_admin),
  reviewers as materialized (
    select u.id, a.reviewer
      from auth.users u
      join everything_admins a on a.email = lower(u.email)
     where a.reviewer is not null
  ),
  vote_names (vote, name) as (values (1, 'helpful'), (0, 'somewhat'), (-1, 'not_helpful'))
  select n.note_id,
         n.submitted_at,
         case n.cn_status
           when 'CURRENTLY_RATED_HELPFUL' then 'helpful'
           when 'CURRENTLY_RATED_NOT_HELPFUL' then 'not_helpful'
           else 'needs_ratings'
         end,
         run.ab_test_picks ->> 'bot',
         coalesce(n.view_count, 0),
         coalesce(d.helpful_count + d.somewhat_helpful_count + d.not_helpful_count, 0),
         fill.picks || run.ab_test_picks,
         everything_note_status(t.p_helpful),
         t.helpful_count + t.somewhat_helpful_count + t.not_helpful_count,
         coalesce(tv.mine, 'none'),
         case when admin.is_admin then coalesce(tv.jim, 'none') end,
         case when admin.is_admin then coalesce(tv.nathan, 'none') end
    from notes n
   cross join fill
   cross join admin
    join everything_notes t on t.x_note_id = n.note_id
    left join lateral (
      select p.ab_test_picks from pipeline_runs p
       where p.note_id = n.note_id
       order by p.created_at desc
       limit 1
    ) run on true
    left join lateral (
      select min(vn.name) filter (where v.voter_id = auth.uid()) as mine,
             min(vn.name) filter (where r.reviewer = 'jim') as jim,
             min(vn.name) filter (where r.reviewer = 'nathan') as nathan
        from everything_votes v
        join vote_names vn using (vote)
        left join reviewers r on r.id = v.voter_id
       where v.note_id = t.id
    ) tv on true
    left join note_ratings_from_public_dump d on d.note_id = n.note_id
   where p_source = 'x' and n.submitted_at is not null and (p_ids is null or n.note_id = any (p_ids))
  union all
  select n.id::text,
         n.created_at,
         everything_note_status(n.p_helpful),
         w.writer,
         null,
         coalesce(n.helpful_count, 0) + coalesce(n.somewhat_helpful_count, 0) + coalesce(n.not_helpful_count, 0),
         case when w.writer = 'pipeline' then fill.picks || run.ab_test_picks end,
         null, null, null, null, null
    from everything_notes n
   cross join fill
   cross join lateral (
     select case
              when exists (select 1 from everything_claude_drafts c where c.note_id = n.id) then 'claude'
              when n.author_id is not null then 'reader'
              else 'pipeline'
            end as writer
   ) w
    left join lateral (
      select p.ab_test_picks from everything_pipeline_runs p
       where p.claim_id = n.claim_id and p.kind = 'check'
       order by p.created_at desc
       limit 1
    ) run on true
   where p_source = 'commonnotes' and n.status <> 'hidden' and n.claim_id is not null and (p_ids is null or n.id::text = any (p_ids))
$$;

create or replace function notewriter_note_ratings(p_source text)
returns table (note_id text, helpful int, somewhat_helpful int, not_helpful int, reasons jsonb, failure_modes text[])
language sql stable security definer set search_path = public as $$
  select d.note_id, d.helpful_count, d.somewhat_helpful_count, d.not_helpful_count,
         coalesce(d.helpful_tag_counts, '{}') || coalesce(d.not_helpful_tag_counts, '{}'),
         (select a.failure_modes from review_dashboard_annotations a
           where a.source = 'production' and a.target_id = d.note_id and a.seen limit 1)
    from note_ratings_from_public_dump d
   where p_source = 'x'
  union all
  select a.target_id, null, null, null, '{}', a.failure_modes
    from review_dashboard_annotations a
   where p_source = 'x' and a.source = 'production' and a.seen
     and not exists (select 1 from note_ratings_from_public_dump d where d.note_id = a.target_id)
  union all
  select n.id::text, coalesce(n.helpful_count, 0), coalesce(n.somewhat_helpful_count, 0), coalesce(n.not_helpful_count, 0), '{}', null
    from everything_notes n
   where p_source = 'commonnotes' and n.claim_id is not null
$$;

create or replace function x_note_cards(p_ids text[]) returns setof x_note_card
language sql stable security definer set search_path = public as $$
  select n.note_id, n.tweet_id, n.note_text,
         d.helpful_count, d.somewhat_helpful_count, d.not_helpful_count, d.helpful_tag_counts, d.not_helpful_tag_counts,
         t.text, t.author_handle, t.author_name, t.posted_at, t.media, t.referenced_tweet_data,
         t.referenced_tweets -> 0 ->> 'type',
         to_jsonb(f) - 'note_id',
         null::float8[],
         tw.id
    from notewriter_field_rows('x', p_ids) f
    join notes n on n.note_id = f.note_id
    join everything_notes tw on tw.x_note_id = n.note_id
    left join tweets t on t.tweet_id = n.tweet_id
    left join note_ratings_from_public_dump d on d.note_id = n.note_id
   order by array_position(p_ids, f.note_id);
$$;

revoke all on function notes_create_twin() from public, anon, authenticated;

notify pgrst, 'reload schema';
