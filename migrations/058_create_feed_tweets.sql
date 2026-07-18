-- Create feed_tweets — one row per tweet ever seen in the eligible-posts feed.
--
-- Populated by the manual capture-feed-tweets GitHub Actions workflow
-- (src/production/captureFeedTweets.ts), which paginates the entire XXL feed
-- and saves every post. Unlike `tweets` (only the posts the bot processed),
-- this accumulates the whole feed for later analysis.
--
-- Column shape mirrors `tweets` (migrations 032 + 045). Engagement metrics are
-- LATEST values, refreshed each time a capture run re-sees the tweet;
-- raw_tweet / media / text are written once at first sight and never rewritten.

CREATE TABLE IF NOT EXISTS feed_tweets (
  tweet_id TEXT PRIMARY KEY,
  author_id TEXT,
  author_handle TEXT,
  author_name TEXT,
  author_description TEXT,
  author_followers BIGINT,
  author_tweet_count BIGINT,
  text TEXT,
  posted_at TIMESTAMPTZ,
  impressions BIGINT,
  likes INTEGER,
  retweets INTEGER,
  replies INTEGER,
  quotes INTEGER,
  bookmarks INTEGER,
  media JSONB,
  referenced_tweets JSONB,
  referenced_tweet_data JSONB,
  raw_tweet JSONB,
  has_video BOOLEAN,
  has_photo BOOLEAN,
  media_count INTEGER,
  video_duration_ms INTEGER,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feed_tweets_author_id ON feed_tweets(author_id);
CREATE INDEX IF NOT EXISTS idx_feed_tweets_posted_at ON feed_tweets(posted_at);
