-- Create table for tracking note status from X's public CN data dumps
-- Tracks both our notes AND competing notes on the same tweets

CREATE TABLE IF NOT EXISTS public_data_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id TEXT NOT NULL,
  tweet_id TEXT NOT NULL,
  current_status TEXT,
  is_ours BOOLEAN NOT NULL DEFAULT FALSE,
  snapshot_date DATE NOT NULL,

  -- Rating counts from the data dump
  created_at_millis BIGINT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate snapshots for the same note on the same day
  UNIQUE(note_id, snapshot_date)
);

-- Index for finding snapshots by tweet (for comparing notes on same tweet)
CREATE INDEX IF NOT EXISTS idx_public_data_snapshots_tweet_id
  ON public_data_snapshots(tweet_id);

-- Index for finding our notes
CREATE INDEX IF NOT EXISTS idx_public_data_snapshots_is_ours
  ON public_data_snapshots(is_ours) WHERE is_ours = TRUE;

-- Index for finding snapshots by date
CREATE INDEX IF NOT EXISTS idx_public_data_snapshots_date
  ON public_data_snapshots(snapshot_date DESC);

-- Index for finding snapshots by status
CREATE INDEX IF NOT EXISTS idx_public_data_snapshots_status
  ON public_data_snapshots(current_status);

-- Comments
COMMENT ON TABLE public_data_snapshots IS 'Time-series snapshots of note status from X public CN data dumps';
COMMENT ON COLUMN public_data_snapshots.note_id IS 'The Community Note ID from X';
COMMENT ON COLUMN public_data_snapshots.tweet_id IS 'The tweet/post this note is attached to';
COMMENT ON COLUMN public_data_snapshots.current_status IS 'Status from noteStatusHistory (CURRENTLY_RATED_HELPFUL, NEEDS_MORE_RATINGS, etc)';
COMMENT ON COLUMN public_data_snapshots.is_ours IS 'TRUE if this note is in our notes table';
COMMENT ON COLUMN public_data_snapshots.snapshot_date IS 'Date of the data dump this came from';
COMMENT ON COLUMN public_data_snapshots.created_at_millis IS 'When the note was created (from CN data)';
