-- Stop the automated "Everything Priority Feeds" runs: unschedule the pg_cron
-- job from migration 067 that dispatched the workflow at :03/:33. The workflow
-- keeps its `workflow_dispatch:` trigger, so runs can still be started manually
-- from the Actions tab.
--
-- To resume, re-run migration 067 (its cron.schedule upserts by job name).

-- Unschedule by jobid so a re-run (job already gone) is a no-op instead of an error.
select cron.unschedule(jobid) from cron.job where jobname = 'dispatch-everything-priority-feeds';

-- Verification (run ad hoc in the SQL editor):
--
--   -- no row should come back
--   select jobid, schedule, active from cron.job where jobname = 'dispatch-everything-priority-feeds';
