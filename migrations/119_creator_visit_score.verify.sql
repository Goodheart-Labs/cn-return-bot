-- Checks for migration 119, run after it against 119_creator_visit_score.fixture.sql
-- (the commands are at the top of the fixture). Every value should be true.
with s as (select * from everything_creator_visit_scores(10))
select
  (select visitors_per_post = 2 and posts = 10 and people = 5 from s where feed_url = 'https://astralcodexten.substack.com') as acx_averages_its_last_ten_posts,
  (select visitors_per_post = 3 and posts = 1 from s where feed_url = 'https://monthly.substack.com') as old_visits_still_count,
  (select visitors_per_post = 1 and posts = 10 and people = 1 from s where feed_url = 'https://www.youtube.com/@binge') as binge_watcher_adds_one_per_post,
  (select count(*) = 1 and min(visitors_per_post) = 2 from s where lower(feed_url) = 'https://www.youtube.com/channel/ucabc') as casings_are_one_creator,
  (select visitors_per_post = 1 from s where feed_url = 'https://oldrow.substack.com') as substack_page_names_its_creator,
  not exists (select 1 from s where feed_url like '%hashless%') as rows_without_hash_count_for_nothing,
  (select count(*) = 5 from s) as five_creators,
  to_regprocedure('everything_creator_attention(timestamptz,int)') is null as old_function_dropped,
  (select author_visitors_per_post = 2 from everything_recent_posts(10, 10) where title = 'ACX post') as dashboard_shows_author_score,
  (select author_visitors_per_post is null from everything_recent_posts(10, 10) where title = 'A web page') as dashboard_project_without_feed_has_no_score,
  not has_function_privilege('anon', 'everything_creator_visit_scores(int)', 'execute') as anon_cannot_read_scores,
  has_function_privilege('anon', 'everything_recent_posts(int,int)', 'execute') as anon_can_read_dashboard;
