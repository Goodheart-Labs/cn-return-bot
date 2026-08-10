-- Review dashboard: materialize the classified item base (074 follow-up).
--
-- Diagnosis (2026-08-10, in-browser + curl instrumentation): the page/counts
-- RPCs are fast warm (0.4-1.8s) but 5-12s COLD, and prod's cache decays within
-- ~10-30s of idle — the view's working set (scattered heap/index pages across
-- pipeline_runs / notes / competing_notes / sightings) doesn't fit the
-- instance's memory alongside the pipeline's churn, so nearly every real visit
-- paid the cold cost.
--
-- Fix: precompute everything SLOW-CHANGING about an item — classification,
-- dates, ab picks, topic — into a compact materialized view (~34k narrow rows,
-- a few MB), refreshed by pg_cron every 5 minutes. Annotations (seen / tags /
-- stars — the live, user-written state) stay OUT of the materialization and are
-- joined live, so toggles reflect instantly. review_dashboard_items_v keeps its
-- exact column set, so the 073 RPCs are untouched.
--
-- Staleness contract: a NEW item, or a status flip (rated, underwater,
-- lost-to-competitor), can lag up to 5 minutes. Review workflow doesn't care;
-- annotation state never lags. The 5-min refresh also keeps the underlying
-- query's cache warm as a side effect.
--
-- ALREADY APPLIED to prod 2026-08-10 via the management API.

create materialized view if not exists review_dashboard_base_m as
select
  id, item_kind, source_id, tweet_id, item_date, is_draft, failure_type,
  pipeline_run_id, bot_name, outcome, outcome_reason, ab_test_picks, topic
from (
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
    sr.bot_name, sr.outcome, sr.outcome_reason, sr.ab_test_picks,
    tp.topic
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
  left join lateral (
    select max(s.topic_id) as topic
    from misinfo_monitoring_sightings s where s.tweet_id = n.tweet_id
  ) tp on true

  union all

  select
    'missed:' || c.note_id, 'missed', c.note_id, c.tweet_id,
    pr.created_at, false, 'missed_opportunity',
    pr.id, null, pr.outcome, pr.outcome_reason, pr.ab_test_picks,
    tp.topic
  from competing_notes c
  join pipeline_runs pr on pr.id = c.pipeline_run_id
  left join lateral (
    select max(s.topic_id) as topic
    from misinfo_monitoring_sightings s where s.tweet_id = c.tweet_id
  ) tp on true
  where c.our_note_id is null
    and c.current_status = 'CURRENTLY_RATED_HELPFUL'
    and c.pipeline_run_id is not null

  union all

  select
    'loweval:' || r.id::text, 'rejection', r.id::text, r.tweet_id,
    r.created_at,
    r.outcome_reason in ('daily_limit_reached', 'check_failed'),
    case r.outcome_reason
      when 'daily_limit_reached' then 'filtered_no_slot'
      when 'check_failed'        then 'draft_check_failed'
      else 'filtered_low_eval_score'
    end,
    r.id, r.bot_name, r.outcome, r.outcome_reason, r.ab_test_picks,
    tp.topic
  from pipeline_runs r
  left join lateral (
    select max(s.topic_id) as topic
    from misinfo_monitoring_sightings s where s.tweet_id = r.tweet_id
  ) tp on true
  where r.outcome_reason in ('low_evaluation_score', 'daily_limit_reached', 'check_failed')
) base;

-- Required by REFRESH CONCURRENTLY, and the page RPC's keyset sort.
create unique index if not exists idx_rdb_m_id on review_dashboard_base_m (id);
create index if not exists idx_rdb_m_sort on review_dashboard_base_m (item_date desc, id desc);
create index if not exists idx_rdb_m_failure_type on review_dashboard_base_m (failure_type);

-- Same column names, types, and ORDER as the 073 view (annotations live).
create or replace view review_dashboard_items_v as
select
  b.id, b.item_kind, b.source_id, b.tweet_id, b.item_date, b.is_draft,
  b.failure_type, b.pipeline_run_id, b.bot_name, b.outcome, b.outcome_reason,
  b.ab_test_picks,
  a.id         as ann_id,
  a.seen       as seen,
  a.failure_modes as failure_modes,
  a.comment    as comment,
  a.high_value as high_value,
  a.updated_at as ann_updated_at,
  b.topic
from review_dashboard_base_m b
left join review_dashboard_annotations a
  on a.source = 'production' and a.target_id = b.id;

grant select on review_dashboard_base_m to service_role;
grant select on review_dashboard_items_v to service_role;

-- Refresh every 5 minutes. Guarded: local dev may lack pg_cron, and re-running
-- the migration must not double-schedule.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'refresh-review-dashboard-base';
    perform cron.schedule(
      'refresh-review-dashboard-base',
      '*/5 * * * *',
      $sql$ refresh materialized view concurrently review_dashboard_base_m $sql$
    );
  else
    raise notice 'pg_cron not installed - schedule the matview refresh manually';
  end if;
end $$;

notify pgrst, 'reload schema';
