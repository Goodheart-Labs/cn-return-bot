-- Drive the "Everything Priority Feeds" workflow (auto-enqueue + process the
-- next unprocessed content of the priority feeds, see
-- src/everything/priorityFeeds.ts) from Supabase pg_cron, the same way
-- migration 047 drives the Create Notes Routine: GitHub's own `schedule:` cron
-- delays and silently drops runs, so the workflow only exposes
-- `workflow_dispatch:` and pg_cron + pg_net POST the dispatch.
--
-- Fires at :03 / :33 — offset from the create-notes dispatch at :18 / :48.
--
-- Reuses the `github_dispatch_pat` secret already in Supabase Vault (created
-- for migration 047).

create extension if not exists pg_cron;
create extension if not exists pg_net;

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
--   -- the job is registered
--   select jobid, schedule, active, command from cron.job where jobname = 'dispatch-everything-priority-feeds';
--
--   -- recent cron firings (did the body run?)
--   select runid, status, start_time, return_message
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'dispatch-everything-priority-feeds')
--   order by start_time desc limit 10;
--
--   -- GitHub's reply (pg_net is async; success = 204 No Content). Rows are
--   -- pruned after a few hours, so check shortly after a :03/:33 tick.
--   select id, status_code, content, created
--   from net._http_response
--   order by created desc limit 10;
--
-- To stop dispatching: select cron.unschedule('dispatch-everything-priority-feeds');
