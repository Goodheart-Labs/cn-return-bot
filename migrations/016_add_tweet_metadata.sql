-- Add tweet metadata columns to capture original tweet info from notewriter cells
-- These are scraped from the tweet embed shown above each community note

-- Snapshots: point-in-time tweet info as observed during scrape
ALTER TABLE scraped_notewriter_snapshots
  ADD COLUMN IF NOT EXISTS tweet_handle TEXT,
  ADD COLUMN IF NOT EXISTS tweet_text TEXT,
  ADD COLUMN IF NOT EXISTS tweet_time TEXT;

-- Notes: canonical tweet info (reconciled from best snapshot)
ALTER TABLE scraped_notewriter_notes
  ADD COLUMN IF NOT EXISTS tweet_handle TEXT,
  ADD COLUMN IF NOT EXISTS tweet_text TEXT,
  ADD COLUMN IF NOT EXISTS tweet_time TEXT;
