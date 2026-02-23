-- Add 'impossible' tier for logically contradictory data
-- e.g. CRH (Currently Rated Helpful) but shown_on_x = false

-- Drop old constraint and add new one with 'impossible'
ALTER TABLE scraped_notewriter_notes
  DROP CONSTRAINT IF EXISTS scraped_notewriter_notes_data_tier_check;

ALTER TABLE scraped_notewriter_notes
  ADD CONSTRAINT scraped_notewriter_notes_data_tier_check
  CHECK (data_tier IN ('platinum', 'gold', 'silver', 'junk', 'impossible'));
