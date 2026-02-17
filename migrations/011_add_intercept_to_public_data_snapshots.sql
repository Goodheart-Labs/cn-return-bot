-- Add coreNoteIntercept and coreNoteFactor1 from CN's public noteStatusHistory data
-- These are the actual numeric scores from the bridging-based matrix factorization:
-- coreNoteIntercept > 0.4 = helpful, < -0.04 = not helpful

ALTER TABLE public_data_snapshots ADD COLUMN IF NOT EXISTS core_note_intercept NUMERIC;
ALTER TABLE public_data_snapshots ADD COLUMN IF NOT EXISTS core_note_factor1 NUMERIC;
