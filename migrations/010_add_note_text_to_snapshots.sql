-- Add note_text to snapshots so each scrape records what text it observed.
-- This allows detection of virtualizer corruption (where the cell shows
-- text from a different note due to DOM recycling).

ALTER TABLE scraped_notewriter_snapshots
  ADD COLUMN IF NOT EXISTS note_text TEXT;

COMMENT ON COLUMN scraped_notewriter_snapshots.note_text IS 'Note text observed during this scrape (may differ between scrapes due to virtualizer cell recycling)';
