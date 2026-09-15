-- Runs on top of the 096 fixture and migration, then 099:
--
--   $PSQL -f migrations/096_feed_pacing.fixture.sql
--   $PSQL --single-transaction -f migrations/096_feed_pacing.sql
--   $PSQL --single-transaction -f migrations/099_pacing_marker_ignores_failed_attempts.sql
--   psql -h 127.0.0.1 -p 55432 -U postgres -q -f migrations/099_pacing_marker_ignores_failed_attempts.verify.sql
\set ON_ERROR_STOP on
\pset pager off

\echo '--- 1. a finished post moves the marker'
update everything_items set status = 'processing' where id = '00000000-0000-0000-0000-000000000107';
update everything_items set status = 'done', processed_at = now() where id = '00000000-0000-0000-0000-000000000107';
\echo '    expected: marker_is_107 true'
set role service_role;
select last_feed_started_at = (select started_at from everything_items where id = '00000000-0000-0000-0000-000000000107') as marker_is_107
from everything_feed_pacing(48, 2, 168, '-infinity');
reset role;

\echo '--- 2. a later attempt that ended in error does not move it'
insert into everything_items (id, url, status, priority, checked_scope) values
  ('00000000-0000-0000-0000-000000000109', 'https://a.example/109', 'queued', 0, 'page');
update everything_items set status = 'processing' where id = '00000000-0000-0000-0000-000000000109';
update everything_items set status = 'error', processed_at = now() where id = '00000000-0000-0000-0000-000000000109';
\echo '    expected: started_later true, marker_is_107 true'
select (select started_at from everything_items where id = '00000000-0000-0000-0000-000000000109') > (select started_at from everything_items where id = '00000000-0000-0000-0000-000000000107') as started_later;
set role service_role;
select last_feed_started_at = (select started_at from everything_items where id = '00000000-0000-0000-0000-000000000107') as marker_is_107
from everything_feed_pacing(48, 2, 168, '-infinity');
reset role;

\echo '--- 3. an item put back in the queue after spending part of its budget does move it'
insert into everything_items (id, url, status, priority, checked_scope) values
  ('00000000-0000-0000-0000-000000000110', 'https://a.example/110', 'queued', 0, 'page');
update everything_items set status = 'processing' where id = '00000000-0000-0000-0000-000000000110';
update everything_items set status = 'queued' where id = '00000000-0000-0000-0000-000000000110';
\echo '    expected: marker_is_110 true'
set role service_role;
select last_feed_started_at = (select started_at from everything_items where id = '00000000-0000-0000-0000-000000000110') as marker_is_110
from everything_feed_pacing(48, 2, 168, '-infinity');
reset role;

\echo '--- 4. the mean still ignores errored items (expected: mean 2.00 over 2 posts, as in the 096 checks)'
set role service_role;
select round(mean_post_cost_usd, 4) as mean, sample_posts from everything_feed_pacing(48, 2, 168, '-infinity');
reset role;
