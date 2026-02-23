-- Add reconciliation columns to scraped_notewriter_notes
-- Part of the snapshot reconciliation system (see docs/snapshot-reconciliation.md)

ALTER TABLE scraped_notewriter_notes
  ADD COLUMN IF NOT EXISTS cn_status TEXT,
  ADD COLUMN IF NOT EXISTS view_count INTEGER,
  ADD COLUMN IF NOT EXISTS data_tier TEXT CHECK (data_tier IN ('platinum', 'gold', 'silver', 'junk')),
  ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMPTZ;

-- tweet_id_flag is replaced by the tier system — drop it
ALTER TABLE scraped_notewriter_notes
  DROP COLUMN IF EXISTS tweet_id_flag;
