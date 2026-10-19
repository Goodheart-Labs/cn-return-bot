-- Runs on top of the 096 fixture and migrations 096, 099 and 125. Each step
-- prints the value it expects next to what the function returns.
--
--   $PSQL -f migrations/096_feed_pacing.fixture.sql
--   $PSQL --single-transaction -f migrations/096_feed_pacing.sql
--   $PSQL --single-transaction -f migrations/099_pacing_marker_ignores_failed_attempts.sql
--   $PSQL -c 'alter table everything_items add column skip_reason text'
--   $PSQL --single-transaction -f migrations/125_pacing_ignores_posts_that_spent_nothing.sql
--   psql -h 127.0.0.1 -p 55432 -U postgres -q -f migrations/125_pacing_ignores_posts_that_spent_nothing.verify.sql
\set ON_ERROR_STOP on
\pset pager off

\echo '--- 0. before anything happens: mean 2.50 over 1 post (101 within 24 hours; the fixture post 107 is queued)'
set role service_role;
select round(mean_post_cost_usd, 4) as mean, sample_posts from everything_feed_pacing(24, 1, 168, '-infinity');
reset role;

\echo '--- 1. a finished post that spent money moves the marker'
update everything_items set status = 'processing' where id = '00000000-0000-0000-0000-000000000107';
insert into everything_pipeline_runs (item_id, kind, cost) values ('00000000-0000-0000-0000-000000000107', 'extraction', 0.10);
update everything_items set status = 'done', processed_at = now() where id = '00000000-0000-0000-0000-000000000107';
\echo '    expected: marker_is_107 true'
set role service_role;
select last_feed_started_at = (select started_at from everything_items where id = '00000000-0000-0000-0000-000000000107') as marker_is_107
from everything_feed_pacing(48, 2, 168, '-infinity');
reset role;

\echo '--- 2. a later video finished as "no captions", with no run row, does not move it'
insert into everything_items (id, url, status, priority, checked_scope) values
  ('00000000-0000-0000-0000-000000000111', 'https://a.example/111', 'queued', 0, 'page');
update everything_items set status = 'processing' where id = '00000000-0000-0000-0000-000000000111';
update everything_items set status = 'done', skip_reason = 'no captions', processed_at = now() where id = '00000000-0000-0000-0000-000000000111';
\echo '    expected: started_later true, marker_is_107 true'
select (select started_at from everything_items where id = '00000000-0000-0000-0000-000000000111') > (select started_at from everything_items where id = '00000000-0000-0000-0000-000000000107') as started_later;
set role service_role;
select last_feed_started_at = (select started_at from everything_items where id = '00000000-0000-0000-0000-000000000107') as marker_is_107
from everything_feed_pacing(48, 2, 168, '-infinity');
reset role;

\echo '--- 3. ... and does not enter the mean: 101 (2.50) and 107 (0.10), not 111'
\echo '    expected: mean 1.3000 over 2 posts'
set role service_role;
select round(mean_post_cost_usd, 4) as mean, sample_posts from everything_feed_pacing(24, 1, 168, '-infinity');
reset role;

\echo '--- 4. an item put back in the queue still moves the marker, run row or not'
insert into everything_items (id, url, status, priority, checked_scope) values
  ('00000000-0000-0000-0000-000000000112', 'https://a.example/112', 'queued', 0, 'page');
update everything_items set status = 'processing' where id = '00000000-0000-0000-0000-000000000112';
update everything_items set status = 'queued' where id = '00000000-0000-0000-0000-000000000112';
\echo '    expected: marker_is_112 true'
set role service_role;
select last_feed_started_at = (select started_at from everything_items where id = '00000000-0000-0000-0000-000000000112') as marker_is_112
from everything_feed_pacing(48, 2, 168, '-infinity');
reset role;

\echo '--- 5. an item in error still does not move it'
insert into everything_items (id, url, status, priority, checked_scope) values
  ('00000000-0000-0000-0000-000000000113', 'https://a.example/113', 'queued', 0, 'page');
update everything_items set status = 'processing' where id = '00000000-0000-0000-0000-000000000113';
update everything_items set status = 'error', processed_at = now() where id = '00000000-0000-0000-0000-000000000113';
\echo '    expected: marker_is_112 true'
set role service_role;
select last_feed_started_at = (select started_at from everything_items where id = '00000000-0000-0000-0000-000000000112') as marker_is_112
from everything_feed_pacing(48, 2, 168, '-infinity');
reset role;
