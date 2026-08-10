-- Review dashboard prod performance (073 follow-up).
--
-- On prod hardware the items view took 15-20s to materialize (vs 0.4s on a dev
-- machine) and the page/counts RPCs tripped the 8s statement timeout — the
-- dashboard showed "canceling statement due to statement timeout" and an empty
-- list. Three fixes, ALREADY APPLIED to prod 2026-08-10 via the management API
-- (this file is the record + the local-parity copy):
--
-- 1. Covering partial indexes so the view's two hottest pipeline_runs accesses
--    are index-only (no scattered heap reads over the logs-heavy table):
--    - the per-note "latest submitted run for this tweet" lateral
--    - the rejections/drafts branch (outcome_reason in the three never-posted
--      reasons), which was reading 17k wide rows from the heap (8s alone)
--    View materialization: 15.2s -> 0.7s warm.
-- 2. review_dashboard_counts: derive A/B slot variants from note rows only
--    (submitted runs). Rejection rows tripled the jsonb_each work for slots the
--    drawer would list identically — every live test also has submitted picks.
-- 3. service_role statement_timeout raised to 30s as a safety ceiling for cold
--    caches (the pipeline's own statements are all small; this is a ceiling,
--    not a slowdown).
--
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction block — run
-- this file with plain psql autocommit (no -1 / BEGIN).

create index concurrently if not exists idx_pr_submitted_latest_cover
  on pipeline_runs (tweet_id, created_at desc)
  include (id, bot_name, outcome, outcome_reason, ab_test_picks)
  where outcome = 'submitted';

create index concurrently if not exists idx_pr_rejections_cover
  on pipeline_runs (outcome_reason, created_at desc)
  include (id, tweet_id, outcome, bot_name, ab_test_picks)
  where outcome_reason in ('low_evaluation_score', 'daily_limit_reached', 'check_failed');

analyze pipeline_runs;

create or replace function review_dashboard_counts(
  p_filters jsonb default '{}'::jsonb
) returns json
language sql stable security definer set search_path = public as $$
  with f as (
    select
      case when p_filters ? 'seen' then (p_filters->>'seen')::boolean end as seen_filter,
      case when p_filters ? 'ab' then p_filters->'ab' end                 as ab
  ),
  -- Only the columns the aggregations read — materializing the full view
  -- row (all hydration columns) into the CTE tuplestore costs ~1s on prod.
  v as (select failure_type, seen, ab_test_picks, item_date, item_kind,
               failure_modes, topic
        from review_dashboard_items_v),
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
  -- Slots come from SUBMITTED runs' picks only (item_kind = 'note') — the
  -- rejection rows triple the jsonb_each work for slots the drawer would show
  -- identically (every live test also has submitted picks).
  ab_variants as (
    select e.key as slot, e.value as variant,
           max(coalesce(v.item_date, 'epoch'::timestamptz)) as last_picked_at
    from v, lateral jsonb_each_text(v.ab_test_picks) e
    where v.ab_test_picks is not null and v.item_kind = 'note'
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

revoke all on function review_dashboard_counts(jsonb) from public, anon, authenticated;
grant execute on function review_dashboard_counts(jsonb) to service_role;

-- Local dev's psql user can't modify the reserved service_role (superuser
-- only) — and local has no timeout pressure anyway. Applied on prod 2026-08-10.
do $$ begin
  alter role service_role set statement_timeout = '30s';
exception when insufficient_privilege then
  raise notice 'skipping service_role timeout (not superuser)';
end $$;

notify pgrst, 'reload schema';

-- 4. JIT off for the two hot RPCs — the dominant remaining cost was Postgres
--    JIT-compiling the big view query on EVERY execution (5-12s calls that
--    dropped to <1s once compiled). These queries are index-lookup-bound, not
--    compute-bound; JIT buys nothing and its compile time is the whole bill.
alter function review_dashboard_counts(jsonb) set jit = off;
alter function review_dashboard_page(jsonb, timestamptz, text, int) set jit = off;

notify pgrst, 'reload config';
