-- Purge dead tables and columns that have no readers in production code.
--
-- Tables/columns dropped here are either entirely unused or have only writers
-- (no readers) — see the schema-cleanup plan for the audit trail.

-- 1. unmatched_scraped_notes — only ever populated by a one-off Nathan import
--    script (scripts_nathan/2026_01_09_scraper_imports/). No production reader.
DROP TABLE IF EXISTS unmatched_scraped_notes;

-- 2. canonical_note_information dead columns
--    - coherence_score: written by reconcileSnapshots, never read in production
--    - rater_tags: never written to canonical (only to snapshots)
--    - top_helpful_tag, top_not_helpful_tag, ratings_updated_at: written by
--      updateNoteFeedback, never read
ALTER TABLE canonical_note_information
  DROP COLUMN IF EXISTS coherence_score,
  DROP COLUMN IF EXISTS rater_tags,
  DROP COLUMN IF EXISTS top_helpful_tag,
  DROP COLUMN IF EXISTS top_not_helpful_tag,
  DROP COLUMN IF EXISTS ratings_updated_at;

-- 3. scraped_notewriter_snapshots dead count columns
--    The current scraper (scrapeNotewriterClickThrough.ts) never populates
--    these — the modal it reads doesn't expose them. They've been frozen at
--    NULL since the Feb 2026 scraper rewrite.
ALTER TABLE scraped_notewriter_snapshots
  DROP COLUMN IF EXISTS helpful_count,
  DROP COLUMN IF EXISTS somewhat_helpful_count,
  DROP COLUMN IF EXISTS not_helpful_count;
