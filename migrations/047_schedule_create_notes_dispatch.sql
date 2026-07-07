-- Drive the "Create Notes Routine" workflow from Supabase instead of GitHub's
-- own scheduler.
--
-- WHY: GitHub's `schedule:` cron is unreliable — under load (worst at round
-- minutes) it delays scheduled runs by minutes and silently DROPS them, which
-- is why the workflow's `*/15` cron fires far rarer than every 15 min. A
-- `workflow_dispatch` POST, by contrast, is honored immediately. Our Postgres
-- is always on, so pg_cron + pg_net give us a dependable 30-min cadence with no
-- new external service. The workflow already exposes `workflow_dispatch:`.
--
-- Fires at :18 / :48 — an arbitrary offset, not load-bearing here (external
-- dispatch isn't subject to GitHub's round-minute congestion), just tidy.
--
-- The GitHub PAT is NOT stored here. It lives in Supabase Vault under the name
-- `github_dispatch_pat`; the cron body reads it at run time. Create it ONCE in
-- the SQL editor (do not commit the real token):
--
--   select vault.create_secret(
--     'github_pat_REPLACE_ME',          -- fine-grained: Actions read+write, repo-scoped
--     'github_dispatch_pat',
--     'PAT for dispatching the Create Notes Routine workflow'
--   );
--
-- The workflow `schedule:` cron stays as a backstop; the workflow's
-- `concurrency` group (cancel-in-progress: false) makes a redundant fire queue
-- rather than double-run.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 3-arg cron.schedule upserts by job name, so re-running this migration is safe.
select cron.schedule(
  'dispatch-create-notes',
  '18,48 * * * *',
  $$
  select net.http_post(
    url     := 'https://api.github.com/repos/Goodheart-Labs/cn-return-bot/actions/workflows/create-notes-routine-dynamic.yml/dispatches',
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
--   select jobid, schedule, active, command from cron.job where jobname = 'dispatch-create-notes';
--
--   -- recent cron firings (did the body run?)
--   select runid, status, start_time, return_message
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'dispatch-create-notes')
--   order by start_time desc limit 10;
--
--   -- GitHub's reply (pg_net is async; success = 204 No Content). Rows are
--   -- pruned after a few hours, so check shortly after a :18/:48 tick.
--   select id, status_code, content, created
--   from net._http_response
--   order by created desc limit 10;
--
-- To stop dispatching: select cron.unschedule('dispatch-create-notes');
