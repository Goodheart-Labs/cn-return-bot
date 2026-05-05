-- Drop the tweet metadata columns from pipeline_runs.
--
-- All these now live on the tweets table (created in migration 032). The
-- writers (processTweet.ts upsertTweet) populate tweets going forward; the
-- backfill script populated historical rows from existing data + logs.
--
-- Run AFTER scripts_jim/2026_05_01_backfill_tweets_from_logs/main.ts has
-- executed against this database, otherwise the historical media data is
-- lost.

DROP INDEX IF EXISTS idx_pipeline_runs_has_video;

ALTER TABLE pipeline_runs
  DROP COLUMN IF EXISTS tweet_text,
  DROP COLUMN IF EXISTS has_video,
  DROP COLUMN IF EXISTS has_photo,
  DROP COLUMN IF EXISTS media_count,
  DROP COLUMN IF EXISTS video_duration_ms,
  DROP COLUMN IF EXISTS tweet_impressions,
  DROP COLUMN IF EXISTS tweet_likes,
  DROP COLUMN IF EXISTS tweet_retweets,
  DROP COLUMN IF EXISTS tweet_replies,
  DROP COLUMN IF EXISTS tweet_quotes,
  DROP COLUMN IF EXISTS tweet_bookmarks,
  DROP COLUMN IF EXISTS author_id,
  DROP COLUMN IF EXISTS author_followers;
