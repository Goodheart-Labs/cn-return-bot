-- Rename scraped_notewriter_notes → canonical_note_information
-- This table holds reconciled, tier-classified canonical data (one row per note).
-- The old name implied raw scraper output; the new name reflects its actual purpose.
-- Postgres automatically updates foreign keys, constraints, and indexes.

ALTER TABLE scraped_notewriter_notes RENAME TO canonical_note_information;

-- Also rename the constraint for consistency
ALTER TABLE canonical_note_information
  RENAME CONSTRAINT scraped_notewriter_notes_data_tier_check
  TO canonical_note_information_data_tier_check;
