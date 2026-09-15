\set ON_ERROR_STOP on
\pset pager off

\echo '--- 1. one row per hour over the window, read as anon'
\echo '    expected: 7 days give 168 rows; the last row is the current hour; the first row is 167 hours before it'
set role anon;
select count(*) as rows_,
       max(hour) = date_trunc('hour', now()) as ends_now,
       min(hour) = date_trunc('hour', now()) - interval '167 hours' as starts_a_week_ago
from everything_spend_by_hour(7);
reset role;

\echo '--- 2. the buckets: this hour 1.75 over 2 runs, 3 hours ago 2.00 over 1, 5 hours ago 0 over 1 (null cost), everything else 0 over 0'
set role anon;
select (date_trunc('hour', now()) - hour) as ago, cost, runs
from everything_spend_by_hour(7)
where runs > 0 or cost > 0
order by hour desc;
\echo '    expected: 168 empty hours minus the three above = 165'
select count(*) as empty_hours from everything_spend_by_hour(7) where runs = 0 and cost = 0;
reset role;

\echo '--- 3. the window is honoured: 1 day gives 24 rows and the row 20 days ago is never included'
set role anon;
select count(*) as rows_, coalesce(sum(cost), 0) as total from everything_spend_by_hour(1);
select coalesce(sum(cost), 0) as total_30_days from everything_spend_by_hour(30);
\echo '    expected: 24 rows, total 3.75; over 30 days the 20-day-old row is inside the window, so 12.75'
reset role;

\echo '--- 4. anon still cannot read the table itself (expected: permission denied)'
set role anon;
\set ON_ERROR_STOP off
select count(*) from everything_pipeline_runs;
\set ON_ERROR_STOP on
reset role;
