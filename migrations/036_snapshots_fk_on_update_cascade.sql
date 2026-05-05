-- Make scraped_notewriter_snapshots.note_id FK cascade on UPDATE.
--
-- supabaseClient.updateScrapedNoteId() exists to rename a placeholder
-- note_id (e.g. "tweet_123…") to the real note_id once the scraper learns
-- it from the modal. The original implementation updated snapshots first
-- then notes, which would always have failed because the FK enforced
-- "snapshots.note_id must reference an existing notes row" — pointing at
-- the new id before notes had it triggers the violation.
--
-- 0 placeholder rows in current prod data so the path was never exercised,
-- but switching the FK's UPDATE action to CASCADE lets a single
-- UPDATE notes.note_id propagate cleanly to snapshots, no manual
-- two-step required. ON DELETE behaviour is unchanged.

BEGIN;

ALTER TABLE scraped_notewriter_snapshots
  DROP CONSTRAINT IF EXISTS scraped_notewriter_snapshots_note_id_fkey;

ALTER TABLE scraped_notewriter_snapshots
  ADD CONSTRAINT scraped_notewriter_snapshots_note_id_fkey
  FOREIGN KEY (note_id) REFERENCES notes(note_id) ON UPDATE CASCADE;

COMMIT;
