-- LessWrong and the Alignment Forum become a first-class feed type (GOO-82).
-- Both run ForumMagnum and share user accounts, so one feed type covers them;
-- the host in the feed URL says which site's posts are walked. This widens the
-- three checks that pin down source and feed type values:
--   * everything_items.source gains 'lesswrong' for posts enqueued from a
--     followed forum author.
--   * everything_followed_feeds.feed_type and everything_follow_requests.feed_type
--     gain 'lesswrong' so forum authors can be followed and requested.

alter table everything_items drop constraint everything_items_source_check;
alter table everything_items add constraint everything_items_source_check
  check (source in ('youtube', 'substack', 'podcast', 'web', 'lesswrong'));

alter table everything_followed_feeds drop constraint everything_followed_feeds_feed_type_check;
alter table everything_followed_feeds add constraint everything_followed_feeds_feed_type_check
  check (feed_type in ('substack', 'youtube', 'lesswrong'));

alter table everything_follow_requests drop constraint everything_follow_requests_feed_type_check;
alter table everything_follow_requests add constraint everything_follow_requests_feed_type_check
  check (feed_type in ('substack', 'youtube', 'lesswrong'));
