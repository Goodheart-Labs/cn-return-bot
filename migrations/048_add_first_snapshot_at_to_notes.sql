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

-- Partial index makes "oldest note with no snapshot" a fast lookup.
CREATE INDEX IF NOT EXISTS idx_notes_first_snapshot_at_null
  ON notes (note_id)
  WHERE first_snapshot_at IS NULL;

COMMENT ON COLUMN notes.first_snapshot_at IS
  'When the notewriter scraper first captured a snapshot of this note (NULL = never scraped). Anchors --incremental scrape.';
