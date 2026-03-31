-- Add pipeline_run_id to competing_notes for missed opportunities.
-- Missed opportunities: tweets we rejected but someone else wrote a helpful note.
-- These rows have our_note_id = NULL and pipeline_run_id set.

-- Make our_note_id nullable (was NOT NULL)
ALTER TABLE competing_notes ALTER COLUMN our_note_id DROP NOT NULL;

-- Add pipeline_run_id column
ALTER TABLE competing_notes ADD COLUMN IF NOT EXISTS pipeline_run_id UUID REFERENCES pipeline_runs(id);

-- Partial unique index for missed opportunity notes (our_note_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_competing_notes_missed
  ON competing_notes(note_id) WHERE our_note_id IS NULL;

-- Index for querying missed opportunities
CREATE INDEX IF NOT EXISTS idx_competing_notes_pipeline_run ON competing_notes(pipeline_run_id);
