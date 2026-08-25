-- Slow the review-dashboard matview refresh from every 5 minutes to every 30.
--
-- Context (incident 2026-08-25, GOO-49): the prod instance (Micro compute,
-- 1 GB RAM) went into disk-IO starvation in the evening. Auth took a minute,
-- catalog reads hit the 2-minute statement timeout, pg_cron could not start
-- workers, and PostgREST answered 503, which took the pipelines and the
-- website down. The refresh was not the trigger of the outage, but it is the
-- single biggest recurring disk-read load: every 5 minutes it re-scans
-- `notes` plus a per-note lateral over `pipeline_runs` and then diffs the
-- result, on a machine whose working set does not fit in memory (see the
-- diagnosis comment in migration 075).
--
-- Trade-off: a new item or a status flip on the review dashboard can now lag
-- up to 30 minutes instead of 5. Annotations (seen / tags / stars) are joined
-- live and never lag. Migration 075's cache-warming side effect is weakened;
-- if cold visits get noticeably slower, tune the schedule back down once the
-- instance has headroom (this migration is a one-line reschedule either way).
--
-- 3-arg cron.schedule upserts by job name, so re-running this is safe.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'refresh-review-dashboard-base',
      '*/30 * * * *',
      $sql$ refresh materialized view concurrently review_dashboard_base_m $sql$
    );
  else
    raise notice 'pg_cron not installed - nothing to reschedule';
  end if;
end $$;
