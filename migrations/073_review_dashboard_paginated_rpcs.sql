-- Review dashboard: server-side item view + paginated RPCs.
--
-- Replaces the dashboard's client-side join layer (browser -> PostgREST, one
-- request-family per table, offset paging + 200-id batching) with three RPCs:
--   review_dashboard_page(filters, cursor)  -> one screenful of fully-hydrated items
--   review_dashboard_counts(filters)        -> pill/tag/burndown/A-B aggregates
--   review_dashboard_posting_notes()        -> tiny rows for the posting-limit drawer
-- RPCs (not views) because PostgREST caps any table/view response at max_rows
-- (1000) while a function returning a json aggregate is uncapped.
--
-- The view UNION-ALLs the three production item shapes the dashboard reviews:
--   note      - our canonical notes (id = notes.note_id)
--   missed    - missed opportunities: helpful competitor notes on tweets we
--               rejected (id = 'missed:' || competing_notes.note_id)
--   rejection - notes written but never submitted: low eval score, cap hit, or
--               pre-submit check failed (id = 'loweval:' || pipeline_runs.id)
-- The 'missed:'/'loweval:' id prefixes ARE the review_dashboard_annotations
-- target_id encoding - annotations key on these exact strings, so the encoding
-- lives here now and the client just writes item.id back on upsert.
--
-- failure_type mirrors the old TS cnStatusToFailureType + isUnderwaterNote
-- (review-dashboard data.ts, deleted with this migration): rated statuses first,
-- then lost_to_competitor (any CURRENTLY_RATED_HELPFUL competitor on the note),
-- then NEEDS_MORE_RATINGS split by the underwater rule. The underwater rule
-- mirrors resolveRatingCounts (dashboard-shared/Ratings.tsx - PER-FIELD
-- public-dump-first coalesce) + the tuned thresholds: >= 5 total ratings and
-- weighted helpfulness (helpful + 0.5 * somewhat) / total < 0.2 (~170 notes at
-- 0.2, tuned by feel 2026-07-14; somewhat counts come from the dump only).
-- If the TS display rule in Ratings.tsx ever changes, change this in step.
--
-- A note's pipeline run is the LATEST submitted run for its tweet - the old JS
-- map was last-fetched-wins (nondeterministic); order by created_at desc is the
-- deliberate, deterministic replacement (may flip ab_test_picks on the handful
-- of multi-run tweets).
--
-- Everything here is service_role-only: the dashboard is a localhost tool whose
-- browser client runs on the injected service key. Never grant anon/authenticated
-- (migration 050 lockdown).

create or replace view review_dashboard_items_v as
select
  n.note_id                                  as id,
  'note'::text                               as item_kind,
  n.note_id                                  as source_id,
  n.tweet_id                                 as tweet_id,
  coalesce(n.submitted_at, n.first_seen_at)  as item_date,
  false                                      as is_draft,
  case
    when n.cn_status = 'CURRENTLY_RATED_HELPFUL'     then 'rated_helpful'
    when n.cn_status = 'CURRENTLY_RATED_NOT_HELPFUL' then 'rated_unhelpful'
    when exists (select 1 from competing_notes c
                 where c.our_note_id = n.note_id
                   and c.current_status = 'CURRENTLY_RATED_HELPFUL')
                                                     then 'lost_to_competitor'
    when n.cn_status = 'NEEDS_MORE_RATINGS' then
      case when uw.is_underwater then 'underwater' else 'needs_more_ratings' end
    else 'uncategorized'
  end                                        as failure_type,
  sr.run_id                                  as pipeline_run_id,
  sr.bot_name                                as bot_name,
  sr.outcome                                 as outcome,
  sr.outcome_reason                          as outcome_reason,
  sr.ab_test_picks                           as ab_test_picks,
  a.id                                       as ann_id,
  a.seen                                     as seen,
  a.failure_modes                            as failure_modes,
  a.comment                                  as comment,
  a.high_value                               as high_value,
  a.updated_at                               as ann_updated_at,
  tp.topic                                   as topic
from notes n
left join lateral (
  select pr.id as run_id, pr.bot_name, pr.outcome, pr.outcome_reason, pr.ab_test_picks
  from pipeline_runs pr
  where pr.tweet_id = n.tweet_id and pr.outcome = 'submitted'
  order by pr.created_at desc
  limit 1
) sr on true
left join lateral (
  select (coalesce(d.helpful_count, n.helpful_count, 0)
        + coalesce(d.somewhat_helpful_count, 0)
        + coalesce(d.not_helpful_count, n.not_helpful_count, 0)) >= 5
     and (coalesce(d.helpful_count, n.helpful_count, 0)
        + 0.5 * coalesce(d.somewhat_helpful_count, 0))::numeric
       / nullif(coalesce(d.helpful_count, n.helpful_count, 0)
              + coalesce(d.somewhat_helpful_count, 0)
              + coalesce(d.not_helpful_count, n.not_helpful_count, 0), 0) < 0.2
         as is_underwater
  from (select 1) one
  left join note_ratings_from_public_dump d on d.note_id = n.note_id
) uw on true
left join review_dashboard_annotations a
  on a.source = 'production' and a.target_id = n.note_id
left join lateral (
  select max(s.topic_id) as topic
  from misinfo_monitoring_sightings s where s.tweet_id = n.tweet_id
) tp on true

union all

select
  'missed:' || c.note_id,
  'missed',
  c.note_id,
  c.tweet_id,
  pr.created_at,
  false,
  'missed_opportunity',
  pr.id,
  null,          -- bot_name intentionally absent: missed-opp cards never showed it
  pr.outcome,
  pr.outcome_reason,
  pr.ab_test_picks,
  a.id, a.seen, a.failure_modes, a.comment, a.high_value, a.updated_at,
  tp.topic
from competing_notes c
join pipeline_runs pr on pr.id = c.pipeline_run_id
left join review_dashboard_annotations a
  on a.source = 'production' and a.target_id = 'missed:' || c.note_id
left join lateral (
  select max(s.topic_id) as topic
  from misinfo_monitoring_sightings s where s.tweet_id = c.tweet_id
) tp on true
where c.our_note_id is null
  and c.current_status = 'CURRENTLY_RATED_HELPFUL'
  and c.pipeline_run_id is not null

union all

select
  'loweval:' || r.id::text,
  'rejection',
  r.id::text,
  r.tweet_id,
  r.created_at,
  r.outcome_reason in ('daily_limit_reached', 'check_failed'),
  case r.outcome_reason
    when 'daily_limit_reached' then 'filtered_no_slot'
    when 'check_failed'        then 'draft_check_failed'
    else 'filtered_low_eval_score'
  end,
  r.id,
  r.bot_name,
  r.outcome,
  r.outcome_reason,
  r.ab_test_picks,
  a.id, a.seen, a.failure_modes, a.comment, a.high_value, a.updated_at,
  tp.topic
from pipeline_runs r
left join review_dashboard_annotations a
  on a.source = 'production' and a.target_id = 'loweval:' || r.id::text
left join lateral (
  select max(s.topic_id) as topic
  from misinfo_monitoring_sightings s where s.tweet_id = r.tweet_id
) tp on true
where r.outcome_reason in ('low_evaluation_score', 'daily_limit_reached', 'check_failed');


-- ── Page RPC ────────────────────────────────────────────────────────────────
-- p_filters keys (all optional; absent = no restriction). The client compiles
-- its lens-precedence tree (topic lens > high-value lens > tag lens > default
-- pills) into this flat conjunction - the SQL stays mechanical on purpose:
--   failureTypes: string[]  - allow-list of failure_type
--   draftsOn:     string[]  - KEY PRESENT = draft gating active: drafts are
--                             hidden unless their failure_type is in this list
--                             (the default/topic lenses; tag/star lenses omit it)
--   seen:         boolean   - annotation seen state (tri-state via absence)
--   tags:         string[]  - annotation failure_modes overlap
--   highValue:    boolean   - starred only
--   ab:           object    - {slot: variant} - every entry must match the
--                             item's ab_test_picks (containment; missing picks fail)
--   topicIds:     string[]  - misinfo topic ids (client derives from topic sets)
--
-- Keyset pagination on (item_date desc, id desc) - null dates sort as epoch,
-- matching the old client sort where a missing createdAt sorted last.
-- totalItems is computed only on the first page (cursor null); nextCursor is
-- returned only when the page came back full.

create or replace function review_dashboard_page(
  p_filters     jsonb       default '{}'::jsonb,
  p_cursor_date timestamptz default null,
  p_cursor_id   text        default null,
  p_page_size   int         default 50
) returns json
language sql stable security definer set search_path = public as $$
  with f as (
    select
      case when jsonb_array_length(coalesce(p_filters->'failureTypes', '[]'::jsonb)) > 0
        then array(select jsonb_array_elements_text(p_filters->'failureTypes')) end as failure_types,
      (p_filters ? 'draftsOn')                                                      as drafts_gate,
      coalesce(array(select jsonb_array_elements_text(p_filters->'draftsOn')), '{}') as drafts_on,
      case when p_filters ? 'seen' then (p_filters->>'seen')::boolean end           as seen_filter,
      case when jsonb_array_length(coalesce(p_filters->'tags', '[]'::jsonb)) > 0
        then array(select jsonb_array_elements_text(p_filters->'tags')) end         as tags,
      coalesce((p_filters->>'highValue')::boolean, false)                           as high_value_only,
      case when p_filters ? 'ab' then p_filters->'ab' end                           as ab,
      case when jsonb_array_length(coalesce(p_filters->'topicIds', '[]'::jsonb)) > 0
        then array(select jsonb_array_elements_text(p_filters->'topicIds')) end     as topic_ids
  ),
  matching as (
    select v.*
    from review_dashboard_items_v v, f
    where (f.failure_types is null or v.failure_type = any(f.failure_types))
      and (not f.drafts_gate or not v.is_draft or v.failure_type = any(f.drafts_on))
      and (f.seen_filter is null or coalesce(v.seen, false) = f.seen_filter)
      and (f.tags is null or coalesce(v.failure_modes, '{}') && f.tags)
      and (not f.high_value_only or coalesce(v.high_value, false))
      and (f.ab is null or coalesce(v.ab_test_picks, '{}'::jsonb) @> f.ab)
      and (f.topic_ids is null or v.topic = any(f.topic_ids))
  ),
  page as (
    select *, coalesce(item_date, 'epoch'::timestamptz) as sort_date
    from matching
    where p_cursor_id is null
       or (coalesce(item_date, 'epoch'::timestamptz), id)
          < (coalesce(p_cursor_date, 'epoch'::timestamptz), p_cursor_id)
    order by coalesce(item_date, 'epoch'::timestamptz) desc, id desc
    limit least(greatest(p_page_size, 1), 200)
  ),
  hydrated as (
    select
      p.*,
      n.note_text        as note_note_text,
      n.cn_status        as note_status,
      n.view_count, n.rating_count, n.helpful_count, n.not_helpful_count,
      t.text             as tweet_text,
      t.author_handle, t.has_photo, t.has_video, t.media_count,
      t.media            as tweet_media,
      t.referenced_tweet_data,
      case when d.note_id is not null then json_build_object(
        'note_id', d.note_id,
        'helpful_count', d.helpful_count,
        'somewhat_helpful_count', d.somewhat_helpful_count,
        'not_helpful_count', d.not_helpful_count,
        'helpful_tag_counts', d.helpful_tag_counts,
        'not_helpful_tag_counts', d.not_helpful_tag_counts,
        'dump_date', d.dump_date
      ) end              as public_dump,
      case
        when p.item_kind = 'note' then
          (select json_agg(json_build_object(
             'noteId', c.note_id, 'noteText', c.note_text, 'status', c.current_status,
             'authorId', c.author_participant_id, 'createdAtMillis', c.created_at_millis))
           from competing_notes c where c.our_note_id = p.source_id)
        when p.item_kind = 'missed' then
          (select json_agg(json_build_object(
             'noteId', c.note_id, 'noteText', c.note_text, 'status', c.current_status,
             'authorId', c.author_participant_id))
           from competing_notes c where c.note_id = p.source_id and c.our_note_id is null)
      end                as comparisons,
      rr.note_text       as run_note_text,
      case when p.item_kind = 'rejection' then
        (select ps.score_value from pipeline_scores ps
         where ps.pipeline_run_id = p.pipeline_run_id and ps.score_type = 'evaluation'
         limit 1)
      end                as evaluation_score
    from page p
    left join notes  n on p.item_kind = 'note' and n.note_id = p.source_id
    left join tweets t on t.tweet_id = p.tweet_id
    left join note_ratings_from_public_dump d
      on p.item_kind = 'note' and d.note_id = p.source_id
    left join pipeline_runs rr
      on p.item_kind = 'rejection' and rr.id = p.pipeline_run_id
  )
  select json_build_object(
    'items', coalesce((select json_agg(json_build_object(
        'id', h.id,
        'source', 'production',
        'tweetId', h.tweet_id,
        'tweetText', h.tweet_text,
        'tweetHandle', h.author_handle,
        'hasPhoto', coalesce(h.has_photo, false),
        'hasVideo', coalesce(h.has_video, false),
        'mediaCount', coalesce(h.media_count, 0),
        'tweetMedia', h.tweet_media,
        'referencedTweetData', h.referenced_tweet_data,
        'noteId', case when h.item_kind = 'note' then h.source_id end,
        'noteText', case when h.item_kind = 'note' then h.note_note_text
                         when h.item_kind = 'rejection' then h.run_note_text end,
        'createdAt', h.item_date,
        'status', h.note_status,
        'viewCount', h.view_count,
        'ratingCount', h.rating_count,
        'helpfulCount', h.helpful_count,
        'notHelpfulCount', h.not_helpful_count,
        'publicDumpRatings', h.public_dump,
        'outcome', h.outcome,
        'outcomeReason', h.outcome_reason,
        'pipelineRunId', h.pipeline_run_id,
        'botId', h.bot_name,
        'abTestPicks', h.ab_test_picks,
        'comparisonNotes', coalesce(h.comparisons, '[]'::json),
        'annotation', case when h.ann_id is not null then json_build_object(
          'id', h.ann_id,
          'seen', coalesce(h.seen, false),
          'failureModes', coalesce(h.failure_modes, '{}'::text[]),
          'comment', h.comment,
          'highValue', coalesce(h.high_value, false)
        ) end,
        'evaluationScore', h.evaluation_score,
        'isDraft', h.is_draft,
        'failureType', h.failure_type,
        'topic', h.topic,
        'sortDate', h.sort_date
      ) order by h.sort_date desc, h.id desc) from hydrated h), '[]'::json),
    'nextCursor', case
      when (select count(*) from page) = least(greatest(p_page_size, 1), 200) then
        (select json_build_object('d', sort_date, 'id', id)
         from page order by sort_date asc, id asc limit 1)
    end,
    'totalItems', case when p_cursor_id is null then (select count(*) from matching) end
  );
$$;


-- ── Counts RPC ──────────────────────────────────────────────────────────────
-- One pass over the view. Only the `seen` and `ab` filter keys apply here (the
-- pills deliberately report the whole picture, not the current pill selection):
--   byFailureType.total    - all-time count (pill label when no narrowing filter)
--   byFailureType.unseen   - not-seen count (burndown backlog inputs)
--   byFailureType.current  - count under {seen, ab} (the seen-aware pill counts)
--   byFailureType.matured30d - items dated 14-44 days ago (burndown inflow proxy)
--   tagCounts.{total,current,last30d} - same for failure-mode tags (last30d =
--     tags on notes dated in the last 30 days; sorts the card selector)
--   seenAnnotationTimes    - updated_at of every seen production annotation
--                            (review-pace + reviewed-today math stays in TS)
--   abVariants             - per (slot, variant) latest item date, feeding the
--                            A/B drawer's slot list (can't be derived from one
--                            loaded page anymore)
--   topicCounts            - items per misinfo topic id (topic-set chips; the
--                            topic -> set grouping lives in TS)

create or replace function review_dashboard_counts(
  p_filters jsonb default '{}'::jsonb
) returns json
language sql stable security definer set search_path = public as $$
  with f as (
    select
      case when p_filters ? 'seen' then (p_filters->>'seen')::boolean end as seen_filter,
      case when p_filters ? 'ab' then p_filters->'ab' end                 as ab
  ),
  v as (select * from review_dashboard_items_v),
  by_type as (
    select
      failure_type,
      count(*)                                              as total,
      count(*) filter (where not coalesce(seen, false))     as unseen,
      count(*) filter (where
        (f.seen_filter is null or coalesce(seen, false) = f.seen_filter)
        and (f.ab is null or coalesce(ab_test_picks, '{}'::jsonb) @> f.ab)) as current,
      count(*) filter (where item_date >= now() - interval '44 days'
                         and item_date <  now() - interval '14 days')       as matured30d
    from v, f
    group by failure_type
  ),
  tag_rows as (
    select u.tag, u.seen, u.ab_test_picks, u.item_kind, u.item_date
    from (select v.*, unnest(coalesce(v.failure_modes, '{}')) as tag from v) u
  ),
  by_tag as (
    select
      tag,
      count(*) as total,
      count(*) filter (where
        (f.seen_filter is null or coalesce(seen, false) = f.seen_filter)
        and (f.ab is null or coalesce(ab_test_picks, '{}'::jsonb) @> f.ab)) as current,
      count(*) filter (where item_kind = 'note'
                         and item_date >= now() - interval '30 days')       as last30d
    from tag_rows, f
    group by tag
  ),
  ab_variants as (
    select e.key as slot, e.value as variant,
           max(coalesce(v.item_date, 'epoch'::timestamptz)) as last_picked_at
    from v, lateral jsonb_each_text(v.ab_test_picks) e
    where v.ab_test_picks is not null
    group by e.key, e.value
  ),
  topics as (
    select topic, count(*) as n from v where topic is not null group by topic
  )
  select json_build_object(
    'byFailureType', coalesce((select json_agg(json_build_object(
        'failureType', failure_type, 'total', total, 'unseen', unseen,
        'current', current, 'matured30d', matured30d)) from by_type), '[]'::json),
    'tagCounts', coalesce((select json_agg(json_build_object(
        'tag', tag, 'total', total, 'current', current, 'last30d', last30d)) from by_tag), '[]'::json),
    'seenAnnotationTimes', coalesce((select json_agg(a.updated_at)
        from review_dashboard_annotations a
        where a.source = 'production' and a.seen), '[]'::json),
    'abVariants', coalesce((select json_agg(json_build_object(
        'slot', slot, 'variant', variant, 'lastPickedAt', last_picked_at)) from ab_variants), '[]'::json),
    'topicCounts', coalesce((select json_agg(json_build_object(
        'topic', topic, 'count', n)) from topics), '[]'::json)
  );
$$;


-- ── Posting-limit drawer data ───────────────────────────────────────────────
-- Every note's status + submission time (~6.6k tiny rows, one request) - the
-- X-writing-cap formula reconstruction stays in TypeScript.

create or replace function review_dashboard_posting_notes()
returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'cn_status', cn_status, 'submitted_at', submitted_at)), '[]'::json)
  from notes;
$$;


-- ── Grants ──────────────────────────────────────────────────────────────────
-- service_role only. Migration 050 revoked anon/authenticated defaults but new
-- functions still default-grant EXECUTE to PUBLIC - revoke that explicitly.

revoke all on function review_dashboard_page(jsonb, timestamptz, text, int) from public, anon, authenticated;
revoke all on function review_dashboard_counts(jsonb) from public, anon, authenticated;
revoke all on function review_dashboard_posting_notes() from public, anon, authenticated;
grant execute on function review_dashboard_page(jsonb, timestamptz, text, int) to service_role;
grant execute on function review_dashboard_counts(jsonb) to service_role;
grant execute on function review_dashboard_posting_notes() to service_role;
grant select on review_dashboard_items_v to service_role;

notify pgrst, 'reload schema';
