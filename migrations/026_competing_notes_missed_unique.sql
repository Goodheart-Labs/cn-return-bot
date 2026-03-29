-- Add composite unique constraint for missed opportunity notes.
-- Allows batch upsert via Supabase JS (which can't target partial unique indexes).
DROP INDEX IF EXISTS idx_competing_notes_missed;
CREATE UNIQUE INDEX IF NOT EXISTS idx_competing_notes_missed
  ON competing_notes(note_id, pipeline_run_id);
