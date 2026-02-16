-- Add tweet_id to snapshots so each scrape records which tweet it observed.
-- This allows majority-vote correction of tweet_id on scraped_notewriter_notes,
-- since the virtualizer can cause the scraper to record the wrong tweet_id.

ALTER TABLE scraped_notewriter_snapshots
  ADD COLUMN IF NOT EXISTS tweet_id TEXT;

-- Add tweet_id_flag to scraped_notewriter_notes for flagging data quality issues.
-- NULL = no issues. Non-null = description of the problem.
ALTER TABLE scraped_notewriter_notes
  ADD COLUMN IF NOT EXISTS tweet_id_flag TEXT;

COMMENT ON COLUMN scraped_notewriter_snapshots.tweet_id IS 'Tweet ID observed during this scrape (may differ between scrapes due to virtualizer)';
COMMENT ON COLUMN scraped_notewriter_notes.tweet_id_flag IS 'NULL if tweet_id is trustworthy. Set when snapshot majority is < 2/3 or disagrees with notes table';
