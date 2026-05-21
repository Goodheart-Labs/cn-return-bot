-- Per-note rating aggregates derived from the X Community Notes public data
-- dump (the daily TSV release). One row per note.
--
-- This is a separate table from `note_rating_tag_counts` because the two
-- sources have different shapes:
--  - note_rating_tag_counts: API `notes_written.scoring_status` —
--    top tag per (model, rater factor bucket). Only available when the API
--    flag has_access is true, which is gated on top-performer status.
--  - this table: public dump — full per-tag distribution, no factor buckets.
--    Available for every published note via the daily TSV release.

CREATE TABLE IF NOT EXISTS note_ratings_from_public_dump (
  note_id TEXT PRIMARY KEY REFERENCES notes(note_id) ON DELETE CASCADE,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  somewhat_helpful_count INTEGER NOT NULL DEFAULT 0,
  not_helpful_count INTEGER NOT NULL DEFAULT 0,
  helpful_tag_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  not_helpful_tag_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  dump_date DATE NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE note_ratings_from_public_dump IS
  'Per-note rating aggregates from the X CN public data dump. helpful_tag_counts / not_helpful_tag_counts store {tag_name: count} for all non-zero tags.';
