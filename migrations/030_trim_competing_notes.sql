-- Trim competing_notes:
--  - rating_count / helpful_count / not_helpful_count have never been
--    populated. The cron just upserts core fields and these stay at 0 forever.
--  - current_core_status / current_decided_by: per CLAUDE.md, current_status
--    is the right column to read; the core/decided_by variants miss notes
--    rated helpful by the expansion or group submodels and aren't worth the
--    duplication.

ALTER TABLE competing_notes
  DROP COLUMN IF EXISTS rating_count,
  DROP COLUMN IF EXISTS helpful_count,
  DROP COLUMN IF EXISTS not_helpful_count,
  DROP COLUMN IF EXISTS current_core_status,
  DROP COLUMN IF EXISTS current_decided_by;
