-- Add the FK from pipeline_runs.note_id → notes.note_id.
--
-- pipeline_runs.note_id was plain TEXT before. Promote it to a real
-- referential integrity constraint now that the merged notes table is the
-- single source of truth for note_id. ON DELETE SET NULL because losing a
-- note row shouldn't cascade-delete the pipeline_run that produced it
-- (the pipeline run is interesting on its own — outcome, scores, logs).

ALTER TABLE pipeline_runs
  ADD CONSTRAINT pipeline_runs_note_id_fkey
  FOREIGN KEY (note_id) REFERENCES notes(note_id) ON DELETE SET NULL;
