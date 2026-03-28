-- Add columns to canonical_note_information that were added to production manually.
-- Used by updateNoteFeedback.ts to enrich canonical data from the notes table.

ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS bot_name TEXT;
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
