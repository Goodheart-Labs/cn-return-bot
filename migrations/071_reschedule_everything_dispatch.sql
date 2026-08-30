-- Resume the automated "Everything Priority Feeds" runs that migration 070
-- stopped: re-register the pg_cron dispatch from migration 067, unchanged
-- (:03/:33, offset from the create-notes dispatch at :18/:48). The batch size
-- lives in code (src/everything/priorityFeeds.ts), now 1 item per run.
--
-- 3-arg cron.schedule upserts by job name, so re-running this migration is safe.

select cron.schedule(
  'dispatch-everything-priority-feeds',
  '3,33 * * * *',
  $$
  select net.http_post(
    url     := 'https://api.github.com/repos/Goodheart-Labs/cn-return-bot/actions/workflows/everything-priority-feeds.yml/dispatches',
    body    := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_dispatch_pat'),
      'Accept',        'application/vnd.github+json',
      'Content-Type',  'application/json',
      'User-Agent',    'supabase-pg-cron'
    )
  );
  $$
);

-- Verification (run ad hoc in the SQL editor):
--
--   select jobid, schedule, active from cron.job where jobname = 'dispatch-everything-priority-feeds';
