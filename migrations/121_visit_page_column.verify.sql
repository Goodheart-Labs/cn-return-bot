-- Checks for migration 121. It runs on the miniature of production that
-- migration 119 tests on, with 119 applied first. Every value should be true.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/119_creator_visit_score.fixture.sql
--   $PSQL --single-transaction -f migrations/119_creator_visit_score.sql
--   $PSQL --single-transaction -f migrations/121_visit_page_column.sql
--   $PSQL -f migrations/121_visit_page_column.verify.sql
--
-- The scores are the ones migration 119's checks expect, with one difference.
-- The fixture has a row with a reader hash and no feed address, on a
-- *.substack.com page. The extension never writes such a row, because it makes
-- the hash from the feed address. Migration 119 still named its creator from
-- the page address. Migration 121 no longer does, so that creator is gone and
-- four creators remain.

-- A row written after the migration gets its page as part of the insert, the
-- same way the browser extension writes one. The fixture has no grants, so the
-- insert grant production gives anon (migration 076) is given here.
grant insert on everything_link_visits to anon;
set role anon;
insert into everything_link_visits (url, feed_url, reader_hash) values
  ('https://www.youtube.com/watch?v=caseA&t=42s', 'https://www.youtube.com/channel/UCabc', 'case-3');
reset role;

with s as (select * from everything_creator_visit_scores(10))
select
  (select visitors_per_post = 2 and posts = 10 and people = 5 from s where feed_url = 'https://astralcodexten.substack.com') as acx_averages_its_last_ten_posts,
  (select visitors_per_post = 3 and posts = 1 from s where feed_url = 'https://monthly.substack.com') as old_visits_still_count,
  (select visitors_per_post = 1 and posts = 10 and people = 1 from s where feed_url = 'https://www.youtube.com/@binge') as binge_watcher_adds_one_per_post,
  (select count(*) = 1 and min(visitors_per_post) = 3 from s where lower(feed_url) = 'https://www.youtube.com/channel/ucabc') as casings_and_new_row_are_one_creator_and_one_page,
  not exists (select 1 from s where feed_url like '%hashless%') as rows_without_hash_count_for_nothing,
  not exists (select 1 from s where feed_url ilike '%oldrow%') as rows_without_feed_count_for_nothing,
  (select count(*) = 4 from s) as four_creators,
  not exists (select 1 from everything_link_visits where page_url is null) as every_row_has_its_page,
  (select page_url = 'https://astralcodexten.substack.com/p/post-1' from everything_link_visits where url like '%utm_source%') as old_row_page_strips_tracking,
  to_regprocedure('everything_visit_creator(text,text)') is null as creator_function_dropped,
  (select author_visitors_per_post = 2 from everything_recent_posts(10, 10) where title = 'ACX post') as dashboard_shows_author_score,
  not has_function_privilege('anon', 'everything_creator_visit_scores(int)', 'execute') as anon_cannot_read_scores,
  has_function_privilege('service_role', 'everything_creator_visit_scores(int)', 'execute') as service_role_can_read_scores;
