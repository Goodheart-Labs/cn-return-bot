-- Create tables for tracking scraped notewriter data
-- Separate from main notes table to avoid mixing with certain data

-- Drop the old note_status_history table (replaced by scraped_notewriter_snapshots)
DROP TABLE IF EXISTS note_status_history;

-- Table for the notes themselves (one row per note, immutable core data)
CREATE TABLE IF NOT EXISTS scraped_notewriter_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id TEXT NOT NULL UNIQUE,
  tweet_id TEXT NOT NULL,
  note_text TEXT,
  source_url TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for finding notes by tweet
CREATE INDEX IF NOT EXISTS idx_scraped_notewriter_notes_tweet_id
  ON scraped_notewriter_notes(tweet_id);

-- Time-series table for tracking changes over time (one row per scrape per note)
CREATE TABLE IF NOT EXISTS scraped_notewriter_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id TEXT NOT NULL REFERENCES scraped_notewriter_notes(note_id),
  cn_status TEXT,
  view_count INTEGER,
  helpful_count INTEGER,
  somewhat_helpful_count INTEGER,
  not_helpful_count INTEGER,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for finding snapshots by note
CREATE INDEX IF NOT EXISTS idx_scraped_notewriter_snapshots_note_id
  ON scraped_notewriter_snapshots(note_id);

-- Index for finding snapshots by time
CREATE INDEX IF NOT EXISTS idx_scraped_notewriter_snapshots_scraped_at
  ON scraped_notewriter_snapshots(scraped_at DESC);

-- Comments
COMMENT ON TABLE scraped_notewriter_notes IS 'Notes scraped from X.com notewriter page - core immutable data';
COMMENT ON TABLE scraped_notewriter_snapshots IS 'Time-series snapshots of note status/metrics from scraping';
COMMENT ON COLUMN scraped_notewriter_snapshots.view_count IS 'Number of views at time of scrape';
COMMENT ON COLUMN scraped_notewriter_snapshots.helpful_count IS 'Helpful ratings at time of scrape';
COMMENT ON COLUMN scraped_notewriter_snapshots.somewhat_helpful_count IS 'Somewhat helpful ratings at time of scrape';
COMMENT ON COLUMN scraped_notewriter_snapshots.not_helpful_count IS 'Not helpful ratings at time of scrape';
