-- Add coherence_score to scraped_notewriter_notes
-- Measures how consistent the underlying snapshots are for each note.
-- 1.0 = all snapshots agree, lower = contradictions detected.

ALTER TABLE scraped_notewriter_notes
  ADD COLUMN IF NOT EXISTS coherence_score REAL;
