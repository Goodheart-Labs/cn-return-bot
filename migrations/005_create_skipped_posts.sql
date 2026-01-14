-- Create table for tracking posts that were skipped/not processed
-- This helps track why posts weren't turned into notes

CREATE TABLE IF NOT EXISTS skipped_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tweet_id TEXT NOT NULL,
  author_id TEXT,
  tweet_text TEXT,
  skip_reason TEXT NOT NULL,

  -- Media information
  has_video BOOLEAN DEFAULT FALSE,
  has_photo BOOLEAN DEFAULT FALSE,
  media_count INTEGER DEFAULT 0,
  video_duration_ms INTEGER,

  -- Pipeline info
  bot_id TEXT,
  pipeline_stage TEXT,  -- 'pre_processing', 'search', 'note_writing', 'check', 'evaluation'
  error_message TEXT,

  -- Metadata
  commit_sha TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Allow multiple skip records per tweet (different runs/reasons)
  -- but prevent exact duplicates in same run
  UNIQUE(tweet_id, skip_reason, created_at)
);

-- Index for finding skipped posts by reason
CREATE INDEX IF NOT EXISTS idx_skipped_posts_reason
  ON skipped_posts(skip_reason);

-- Index for finding skipped posts by date
CREATE INDEX IF NOT EXISTS idx_skipped_posts_created_at
  ON skipped_posts(created_at DESC);

-- Index for finding video posts specifically
CREATE INDEX IF NOT EXISTS idx_skipped_posts_has_video
  ON skipped_posts(has_video) WHERE has_video = TRUE;

-- Index for finding posts by tweet
CREATE INDEX IF NOT EXISTS idx_skipped_posts_tweet_id
  ON skipped_posts(tweet_id);

-- Add comments
COMMENT ON TABLE skipped_posts IS 'Posts that were skipped during processing, with reasons';
COMMENT ON COLUMN skipped_posts.tweet_id IS 'The tweet/post ID that was skipped';
COMMENT ON COLUMN skipped_posts.skip_reason IS 'Why the post was skipped (e.g., has_video, pipeline_error, low_score)';
COMMENT ON COLUMN skipped_posts.has_video IS 'Whether the post contains video media';
COMMENT ON COLUMN skipped_posts.has_photo IS 'Whether the post contains photo media';
COMMENT ON COLUMN skipped_posts.video_duration_ms IS 'Duration of video in milliseconds (if applicable)';
COMMENT ON COLUMN skipped_posts.pipeline_stage IS 'Which stage of the pipeline the skip occurred at';
COMMENT ON COLUMN skipped_posts.bot_id IS 'Which bot was processing when skip occurred';
