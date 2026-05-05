-- Add the FK from pipeline_runs.note_id → notes.note_id.
--
-- pipeline_runs.note_id was plain TEXT before. Promote it to a real
-- referential integrity constraint now that the merged notes table is the
-- single source of truth for note_id. ON DELETE SET NULL because losing a
-- note row shouldn't cascade-delete the pipeline_run that produced it
-- (the pipeline run is interesting on its own — outcome, scores, logs).
--
-- First clear any orphan note_ids (rows whose referenced note was already
-- gone before this FK existed). Discovered by running the migration on a
-- prod-data sample in scripts_jim/2026_05_01_merge_canonical_into_notes/
-- verify_migrations_on_prod_data.ts — without this UPDATE, the
-- ADD CONSTRAINT throws on those rows.
--
-- Wrapped in a transaction so the UPDATE and ADD CONSTRAINT either both
-- apply or both roll back — leaving NULLed orphans without an enforcing
-- FK would silently weaken referential integrity going forward.
BEGIN;

UPDATE pipeline_runs
  SET note_id = NULL
  WHERE note_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM notes WHERE notes.note_id = pipeline_runs.note_id);

ALTER TABLE pipeline_runs
  ADD CONSTRAINT pipeline_runs_note_id_fkey
  FOREIGN KEY (note_id) REFERENCES notes(note_id) ON DELETE SET NULL;

COMMIT;
