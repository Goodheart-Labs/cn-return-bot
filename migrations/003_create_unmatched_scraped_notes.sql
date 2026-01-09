-- Create table for tracking unmatched scraped notes
-- These are notes found on X.com that aren't in our main notes table
-- (created before our tracking started)

CREATE TABLE IF NOT EXISTS unmatched_scraped_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id TEXT NOT NULL,
  tweet_id TEXT NOT NULL,
  note_text TEXT NOT NULL,
  cn_status TEXT,
  view_count INTEGER,
  views_last_updated_at TIMESTAMPTZ,
  source_url TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate entries for the same note
  UNIQUE(note_id)
);

-- Index for finding notes by tweet
CREATE INDEX IF NOT EXISTS idx_unmatched_scraped_notes_tweet_id
  ON unmatched_scraped_notes(tweet_id);

-- Index for finding notes by discovery date
CREATE INDEX IF NOT EXISTS idx_unmatched_scraped_notes_discovered_at
  ON unmatched_scraped_notes(discovered_at DESC);

-- Index for finding notes by status
CREATE INDEX IF NOT EXISTS idx_unmatched_scraped_notes_status
  ON unmatched_scraped_notes(cn_status);

-- Add comments
COMMENT ON TABLE unmatched_scraped_notes IS 'Community Notes found on X.com that are not in our main notes table';
COMMENT ON COLUMN unmatched_scraped_notes.note_id IS 'The Community Note ID from X.com';
COMMENT ON COLUMN unmatched_scraped_notes.tweet_id IS 'The tweet/post ID that the note is attached to';
COMMENT ON COLUMN unmatched_scraped_notes.note_text IS 'Full text of the community note';
COMMENT ON COLUMN unmatched_scraped_notes.cn_status IS 'Status of the note (e.g., CURRENTLY_RATED_HELPFUL, NEEDS_MORE_RATINGS)';
COMMENT ON COLUMN unmatched_scraped_notes.view_count IS 'Number of views (updated on each scrape)';
COMMENT ON COLUMN unmatched_scraped_notes.views_last_updated_at IS 'When the view count was last updated';
COMMENT ON COLUMN unmatched_scraped_notes.source_url IS 'URL cited in the note';
COMMENT ON COLUMN unmatched_scraped_notes.discovered_at IS 'When this note was first scraped and discovered';
COMMENT ON COLUMN unmatched_scraped_notes.last_checked_at IS 'When this note was last checked/updated';
