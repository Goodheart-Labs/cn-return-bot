-- Per-day origin composition of rated-helpful Community Notes, derived from the
-- X CN public data dump (notes.tsv joined with noteStatusHistory.tsv on
-- currentStatus = CURRENTLY_RATED_HELPFUL). One row per UTC day.
--
-- Powers the stats-dashboard "% of all" view: of every note created on a day
-- that is currently rated helpful, how many are ours vs the top other AI
-- notewriters vs human-written (the remainder). Populated by
-- src/production/updateNoteFeedback.ts, which already downloads + scans the dump.
--
-- Bounded to our active window (days >= our first note) so the table stays
-- small (tens-to-hundreds of rows). Human-written helpful is derived at render
-- time as helpful_total - helpful_ours - helpful_other_ai.

CREATE TABLE IF NOT EXISTS daily_note_origin_counts (
  day               DATE PRIMARY KEY,
  helpful_total     INTEGER NOT NULL,
  helpful_ours      INTEGER NOT NULL,
  helpful_other_ai  INTEGER NOT NULL,
  last_synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE daily_note_origin_counts IS
  'Per-UTC-day origin split of CURRENTLY_RATED_HELPFUL notes from the X CN public dump: total / ours / top-9 other AI notewriters. Human = total - ours - other_ai.';
