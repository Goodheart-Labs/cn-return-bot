\set ON_ERROR_STOP on
\pset pager off

\echo '--- 1. the row exists with no alarm and nothing dispatched'
\echo '    expected: one row, alarm null, dispatched null'
select count(*) as rows, bool_and(next_run_at is null) as alarm_null, bool_and(dispatched_at is null) as dispatched_null from everything_feed_schedule;

\echo '--- 2. with no alarm ever set the first tick dispatches (that is how the pipeline bootstraps)'
\echo '    expected: dispatched true, then one POST to the workflow with ref main and the Vault token, dispatched_at set'
select everything_dispatch_feed_run_if_due() as dispatched;
select url like '%everything-priority-feeds.yml/dispatches' as right_workflow, body->>'ref' as ref, headers->>'Authorization' as auth from net.sent;
select dispatched_at is not null as dispatched_at_set, next_run_at is null as alarm_null from everything_feed_schedule;

\echo '--- 3. the next tick does not dispatch again while that run is starting'
\echo '    expected: dispatched false, still 1 POST'
select everything_dispatch_feed_run_if_due() as dispatched;
select count(*) as posts from net.sent;

\echo '--- 4. the run sets an alarm 10 minutes out: dispatched_at clears, and a tick does not dispatch'
set role service_role;
select everything_set_feed_alarm(now() + interval '10 minutes', 'interval');
reset role;
\echo '    expected: reason interval, dispatched_null true, dispatched false, still 1 POST'
select next_run_reason, dispatched_at is null as dispatched_null from everything_feed_schedule;
select everything_dispatch_feed_run_if_due() as dispatched;
select count(*) as posts from net.sent;

\echo '--- 5. an alarm in the past dispatches at the next tick and clears itself'
set role service_role;
select everything_set_feed_alarm(now() - interval '1 minute', 'interval');
reset role;
\echo '    expected: dispatched true, 2 POSTs, alarm_null true, dispatched_at_set true'
select everything_dispatch_feed_run_if_due() as dispatched;
select count(*) as posts from net.sent;
select next_run_at is null as alarm_null, dispatched_at is not null as dispatched_at_set from everything_feed_schedule;

\echo '--- 6. the backstop: a run that has not set its alarm 44 minutes after dispatch is left alone, at 46 minutes another run is dispatched'
update everything_feed_schedule set dispatched_at = now() - interval '44 minutes';
\echo '    expected: dispatched false'
select everything_dispatch_feed_run_if_due() as dispatched;
update everything_feed_schedule set dispatched_at = now() - interval '46 minutes';
\echo '    expected: dispatched true, 3 POSTs'
select everything_dispatch_feed_run_if_due() as dispatched;
select count(*) as posts from net.sent;

\echo '--- 7. the cron job was replaced under its old name, and the cleanup job exists'
\echo '    expected: dispatch-everything-priority-feeds every minute calling the function; cleanup-cron-history nightly'
select jobname, schedule, command from cron.job order by jobname;

\echo '--- 8. a second row is impossible, and so is an unknown reason (expected: two errors)'
\set ON_ERROR_STOP off
insert into everything_feed_schedule (id) values (false);
set role service_role;
select everything_set_feed_alarm(now(), 'bogus');
reset role;
\set ON_ERROR_STOP on

\echo '--- 9. anon can neither set the alarm nor dispatch, and the service role cannot dispatch (expected: three permission errors)'
\set ON_ERROR_STOP off
set role anon;
select everything_set_feed_alarm(now(), 'interval');
select everything_dispatch_feed_run_if_due();
reset role;
set role service_role;
select everything_dispatch_feed_run_if_due();
reset role;
\set ON_ERROR_STOP on
