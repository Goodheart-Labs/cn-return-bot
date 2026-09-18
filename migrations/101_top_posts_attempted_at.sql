-- 101: remember a failed top-posts refresh, so a creator whose channel
-- listing fails is retried the next day instead of on every run.
--
-- loadTopPosts (src/everything/topPosts.ts) refreshes the stalest creator's
-- all-time-top list once per run. It stamped top_posts_refreshed_at only on
-- success, so a creator whose listing kept failing was the stalest one in
-- every run and paid for the same failure all day: joerogan, 43 times on
-- 2026-09-16 (GOO-169). The stamp below is set on failure and cleared on
-- success; the code refreshes a creator only when the list is a week old
-- and no attempt was made in the last day.

alter table everything_projects add column top_posts_attempted_at timestamptz;

comment on column everything_projects.top_posts_attempted_at is
  'When a refresh of this creator''s everything_top_posts rows was last tried and failed. Null when the last attempt succeeded or none was made. Together with top_posts_refreshed_at it decides when the next attempt is due.';
