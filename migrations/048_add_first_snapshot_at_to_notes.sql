-- Track when each note first received a notewriter-scraper snapshot.
--
-- The --incremental scrape needs the oldest note that has no snapshot yet. Doing
-- that as a client-side anti-join meant pulling the ENTIRE scraped_notewriter_snapshots
-- time-series over the wire on every run (it grows one row per note per scrape).
-- With this column + a partial index, "oldest un-snapshotted note" becomes a cheap
-- indexed lookup that is independent of how large the snapshot history gets.
--
-- The scraper stamps this on a note's first snapshot (markFirstSnapshot in
-- supabaseClient.ts). Apply this migration BEFORE deploying that scraper code.

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS first_snapshot_at TIMESTAMPTZ;

-- How many --incremental runs scrolled past this note but failed to capture it
-- while it still had no snapshot. 0 = fine, 1 = missed once, 2 = given up
-- (excluded from the incremental anchor so a permanently-deleted note can't pin
-- the daily window). A later capture stamps first_snapshot_at and retires it anyway.
ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS scrape_misses INTEGER NOT NULL DEFAULT 0;

-- Backfill: any note that already has at least one snapshot gets its earliest
-- snapshot time. Uses the existing idx_scraped_notewriter_snapshots_note_id index.
UPDATE notes n
SET first_snapshot_at = s.first_at
FROM (
  SELECT note_id, MIN(scraped_at) AS first_at
  FROM scraped_notewriter_snapshots
  GROUP BY note_id
) s
WHERE s.note_id = n.note_id
  AND n.first_snapshot_at IS NULL;

-- Partial index makes "oldest note still eligible to anchor the incremental
-- scrape" a fast lookup; it shrinks as notes are captured or given up.
CREATE INDEX IF NOT EXISTS idx_notes_incremental_anchor
  ON notes (note_id)
  WHERE first_snapshot_at IS NULL AND scrape_misses < 2;

COMMENT ON COLUMN notes.first_snapshot_at IS
  'When the notewriter scraper first captured a snapshot of this note (NULL = never scraped). Anchors --incremental scrape.';

COMMENT ON COLUMN notes.scrape_misses IS
  'Incremental runs that scrolled past this note without capturing it (0/1); 2 = given up, excluded from the incremental anchor.';
