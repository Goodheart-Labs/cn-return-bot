-- Add columns for candidate staging system + comprehensive logging
-- Supports the two-phase pipeline: generate candidates, then submit best ones

-- Note content (previously only stored for submitted notes)
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS note_text TEXT;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS note_status TEXT;

-- Context that informed the note
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS search_results TEXT;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS check_reasoning TEXT;

-- Tweet engagement at processing time
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS tweet_impressions BIGINT;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS tweet_likes INTEGER;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS tweet_retweets INTEGER;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS tweet_replies INTEGER;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS tweet_quotes INTEGER;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS tweet_bookmarks INTEGER;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS author_followers BIGINT;

-- Index for candidate queries (fetch unsubmitted candidates for ranking)
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_candidate
  ON pipeline_runs(outcome, created_at DESC)
  WHERE outcome = 'candidate';
