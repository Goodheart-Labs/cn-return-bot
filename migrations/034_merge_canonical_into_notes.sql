-- Merge canonical_note_information into notes.
--
-- These two tables overlap heavily — canonical is "every note we've ever
-- observed" (~2400 rows including pre-tracking scrapes), the old `notes`
-- table is "notes we submitted via the X API" (~990 rows). After this
-- migration there's a single notes table with submission metadata
-- (notewriter_id / submitted_at) nullable for pre-tracking rows.
--
-- The order matters: backfill the new columns onto canonical FROM the old
-- notes table BEFORE dropping the old table, then drop dropped columns and
-- rename canonical → notes.
--
-- All incoming FKs (competing_notes.our_note_id, scraped_notewriter_snapshots.note_id)
-- already reference canonical_note_information(note_id). Postgres rewrites them
-- automatically on RENAME, so no FK surgery is needed.
--
-- Wrapped in a single transaction so a failure mid-migration leaves the DB
-- in the previous shape rather than a half-merged state where, say, the old
-- notes table is dropped but the rename to "notes" hasn't run yet.

BEGIN;

-- 1. Add the columns we'll keep on the merged table.
ALTER TABLE canonical_note_information
  ADD COLUMN IF NOT EXISTS notewriter_id TEXT,
  ADD COLUMN IF NOT EXISTS somewhat_helpful_count INTEGER NOT NULL DEFAULT 0;

-- 2. Backfill from old notes (notewriter_id was the only column there worth
-- preserving — submitted_at is already populated by updateNoteFeedback's
-- enrichment, but we refresh it from old notes for any rows the cron missed).
UPDATE canonical_note_information c
  SET notewriter_id = n.notewriter_id,
      submitted_at = COALESCE(c.submitted_at, n.submitted_at)
  FROM notes n
  WHERE c.note_id = n.note_id
    AND n.notewriter_id IS NOT NULL;

-- Also pull somewhat_helpful_count from the old notes table where it has data
-- (most rows are 0; this preserves any actual values that were set historically).
UPDATE canonical_note_information c
  SET somewhat_helpful_count = n.somewhat_helpful_count
  FROM notes n
  WHERE c.note_id = n.note_id
    AND n.somewhat_helpful_count > 0;

-- 3. Drop the old notes table (no FKs reference it).
DROP TABLE notes;

-- 4. Drop the public-data-derived and tweet-metadata columns from canonical.
-- All recoverable from public data dumps or moved to tweets.
ALTER TABLE canonical_note_information
  DROP COLUMN IF EXISTS tweet_handle,
  DROP COLUMN IF EXISTS tweet_text,
  DROP COLUMN IF EXISTS tweet_time,
  DROP COLUMN IF EXISTS current_core_status,
  DROP COLUMN IF EXISTS current_expansion_status,
  DROP COLUMN IF EXISTS current_group_status,
  DROP COLUMN IF EXISTS current_decided_by,
  DROP COLUMN IF EXISTS current_modeling_group,
  DROP COLUMN IF EXISTS first_non_nmr_status,
  DROP COLUMN IF EXISTS most_recent_non_nmr_status,
  DROP COLUMN IF EXISTS locked_status,
  DROP COLUMN IF EXISTS status_updated_at,
  DROP COLUMN IF EXISTS first_non_nmr_at,
  DROP COLUMN IF EXISTS status_locked_at,
  DROP COLUMN IF EXISTS classification,
  DROP COLUMN IF EXISTS public_data_updated_at,
  DROP COLUMN IF EXISTS bot_name,
  DROP COLUMN IF EXISTS created_at;
-- bot_name was being enriched by updateNoteFeedback from the old notes table;
-- post-merge, bot info comes from pipeline_runs (join via note_id).
-- created_at is covered by first_seen_at.

-- 5. Rename to notes. Existing constraints and FKs follow the table.
ALTER TABLE canonical_note_information RENAME TO notes;

-- Rename the old check constraint to match the new table name.
ALTER TABLE notes
  RENAME CONSTRAINT canonical_note_information_data_tier_check
  TO notes_data_tier_check;

COMMIT;
