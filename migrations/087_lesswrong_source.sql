-- LessWrong and the Alignment Forum become a first-class source (GOO-82).
-- Both run ForumMagnum and share user accounts, so one source covers them; the
-- host in a feed URL says which site's posts are walked.
--
-- Applied to production on 2026-09-02 under the number 085, before 086 renamed
-- the numbering. The two feed_type checks it also widened then were on
-- everything_followed_feeds and everything_follow_requests, which 086 has since
-- dropped, so this file records only the part that still exists. Re-running it
-- is harmless: the constraint is dropped and recreated identically.
--
-- The feed side needs no migration of its own: everything_feed_slug() in 086
-- already derives a slug from a /users/<slug> profile URL on either host, and
-- the shape CHECK on everything_projects.feed_url accepts it.

alter table everything_items drop constraint everything_items_source_check;
alter table everything_items add constraint everything_items_source_check
  check (source in ('youtube', 'substack', 'podcast', 'web', 'lesswrong'));
