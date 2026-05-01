-- Create tweets table — one row per X tweet we've processed.
--
-- Mirrors the shape of the `Post` object (src/api/fetchEligiblePosts.ts) so
-- the parallel "pass full Post to bots" branch (refactor/bot-uses-post-type)
-- can land its data here directly. Engagement metrics are LATEST values,
-- refreshed on every pipeline run touching this tweet (no per-run history).
--
-- Backfills from the existing pipeline_runs columns. Author name/description
-- and the raw media JSONB are NULL for historical rows; a separate one-shot
-- TS script (scripts_jim/2026_05_01_backfill_tweets_from_logs/) populates
-- them from the logs JSONB after this migration runs.

CREATE TABLE IF NOT EXISTS tweets (
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
  has_video BOOLEAN,
  has_photo BOOLEAN,
  media_count INTEGER,
  video_duration_ms INTEGER,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tweets_author_id ON tweets(author_id);

-- Backfill from the columns that already live on pipeline_runs. Each tweet
-- can have multiple pipeline_runs (retries) — collapse with MAX/MIN.
INSERT INTO tweets (
  tweet_id, author_id, text,
  has_video, has_photo, media_count, video_duration_ms,
  impressions, likes, retweets, replies, quotes, bookmarks,
  author_followers, first_seen_at, last_updated_at
)
SELECT
  tweet_id,
  MAX(author_id),
  MAX(tweet_text),
  bool_or(COALESCE(has_video, false)),
  bool_or(COALESCE(has_photo, false)),
  MAX(media_count),
  MAX(video_duration_ms),
  MAX(tweet_impressions),
  MAX(tweet_likes),
  MAX(tweet_retweets),
  MAX(tweet_replies),
  MAX(tweet_quotes),
  MAX(tweet_bookmarks),
  MAX(author_followers),
  MIN(created_at),
  MAX(created_at)
FROM pipeline_runs
WHERE tweet_id IS NOT NULL
GROUP BY tweet_id
ON CONFLICT (tweet_id) DO NOTHING;
