-- The feed view recorder's own record of each post (GOO-834). The recorder
-- (src/feed-views/main.ts) writes one row the first time it sees a post in the
-- XL feed, with what a view prediction model may use besides the counts: when
-- it was posted, its author's size, its kind and its text.
--
-- The recorder does not write feed_tweets, because that table freezes what the
-- X run saw first. But the X run reads the feed only when X's writing limit
-- lets it, so on 2026-11-21 one in five recorded posts had no feed_tweets row,
-- mostly the posts that entered the feed after the recorder started. This
-- table covers every recorded post.
--
-- When the recorder first saw a post is the first observed_at in
-- feed_tweet_views, so it is not stored again here. The table is part of the
-- one-time collection and goes when feed_tweet_views goes (GOO-845).
--
-- Only the service role writes and reads it.
create table feed_view_posts (
  tweet_id bigint primary key,
  posted_at timestamptz not null,
  author_id text,
  author_followers bigint,
  author_tweet_count bigint,
  -- X's verified_type of the author: blue, business, government or none.
  author_verified_type text,
  lang text,
  -- quoted or replied_to when the post quotes or answers another post.
  referenced_type text,
  has_video boolean not null,
  has_photo boolean not null,
  video_duration_ms integer,
  text text
);

alter table feed_view_posts enable row level security;
revoke all on feed_view_posts from anon, authenticated;

notify pgrst, 'reload schema';
