\set ON_ERROR_STOP on
\pset pager off

\echo '--- 1. the recent window is used when it holds enough posts'
\echo '    expected: spent_today 52.45 (0.50 + 0.25 + 1.00 + 50.00 + 0.40 + 0.30; the 0.75 and 1.50 rows are yesterday),'
\echo '              mean 2.00 over 2 posts in 48 hours (101 costs 2.50 with its yesterday row, 102 costs 1.50),'
\echo '              last_feed_started_at null (nothing has been stamped yet)'
set role service_role;
select spent_today_usd, round(mean_post_cost_usd, 4) as mean, sample_posts, sample_hours, last_feed_started_at
from everything_feed_pacing(48, 2, 168, '-infinity');
reset role;

\echo '--- 2. the fallback window is used when the recent one is too thin'
\echo '    expected: mean 3.3333 over 3 posts in 168 hours (2.50, 1.50 and 6.00)'
set role service_role;
select round(mean_post_cost_usd, 4) as mean, sample_posts, sample_hours from everything_feed_pacing(48, 3, 168, '-infinity');
reset role;

\echo '--- 3. a post finished before not_before never counts, in either window'
\echo '    expected: mean 2.50 over 1 post in 48 hours (102 at 30 hours ago is before the cutoff 20 hours ago; so is 106),'
\echo '              then mean 2.50 over 1 post in 168 hours when the recent window is asked for 2'
set role service_role;
select round(mean_post_cost_usd, 4) as mean, sample_posts, sample_hours from everything_feed_pacing(48, 1, 168, now() - interval '20 hours');
select round(mean_post_cost_usd, 4) as mean, sample_posts, sample_hours from everything_feed_pacing(48, 2, 168, now() - interval '20 hours');
reset role;

\echo '--- 4. with no finished post after not_before the mean is null and the count 0'
set role service_role;
select mean_post_cost_usd, sample_posts, sample_hours from everything_feed_pacing(48, 1, 168, now());
reset role;

\echo '--- 5. the trigger stamps started_at when an item enters processing, and only then'
update everything_items set status = 'processing' where id = '00000000-0000-0000-0000-000000000107';
\echo '    expected: stamped true'
select started_at is not null as stamped from everything_items where id = '00000000-0000-0000-0000-000000000107';
create temp table stamp_before as select started_at from everything_items where id = '00000000-0000-0000-0000-000000000107';
update everything_items set status = 'done', processed_at = now() where id = '00000000-0000-0000-0000-000000000107';
\echo '    expected: unchanged true (finishing does not restamp), ordered true'
select started_at = (select started_at from stamp_before) as unchanged, started_at <= processed_at as ordered
from everything_items where id = '00000000-0000-0000-0000-000000000107';

\echo '--- 6. the snapshot now sees that start, and its clock is the database clock'
\echo '    expected: seen true, clock_ok true'
set role service_role;
select last_feed_started_at is not null as seen, db_now >= last_feed_started_at as clock_ok from everything_feed_pacing(48, 2, 168, '-infinity');
reset role;

\echo '--- 7. a requested-tier start does not move the feed marker'
insert into everything_items (id, url, status, priority, checked_scope) values
  ('00000000-0000-0000-0000-000000000108', 'https://a.example/108', 'queued', 2, 'page');
update everything_items set status = 'processing' where id = '00000000-0000-0000-0000-000000000108';
\echo '    expected: feed_marker_is_107 true'
set role service_role;
select last_feed_started_at = (select started_at from everything_items where id = '00000000-0000-0000-0000-000000000107') as feed_marker_is_107
from everything_feed_pacing(48, 2, 168, '-infinity');
reset role;

\echo '--- 8. anon cannot call the snapshot (expected: permission denied)'
set role anon;
\set ON_ERROR_STOP off
select * from everything_feed_pacing(48, 2, 168, '-infinity');
\set ON_ERROR_STOP on
reset role;
