ALTER TABLE canonical_note_information
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS bot_name text;
