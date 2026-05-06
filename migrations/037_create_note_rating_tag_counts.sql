-- Top helpful and top not-helpful tag per (model, rater factor bucket) for
-- each of our notes, sourced from X API `notes_written` -> scoring_status.
--
-- Caveats:
--  - The API exposes only the *top* tag per direction per bucket, not the
--    full per-tag distribution.
--  - Rows are populated only when `scoring_status.has_access === true`,
--    which the API gates on the notewriter being currently top-performing.
--    If our notewriter doesn't qualify, this table stays empty.
--  - At most 2 (helpful + not-helpful) × 3 (factor buckets) = 6 rows per
--    note per model.

CREATE TABLE IF NOT EXISTS note_rating_tag_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  count INTEGER NOT NULL,
  rater_bucket TEXT NOT NULL CHECK (rater_bucket IN ('negative', 'neutral', 'positive')),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (note_id, model_name, tag_name, rater_bucket)
);

CREATE INDEX IF NOT EXISTS idx_note_rating_tag_counts_note_id
  ON note_rating_tag_counts(note_id);

COMMENT ON TABLE note_rating_tag_counts IS
  'Top helpful and top not-helpful tag per (model, rater factor bucket) from X API scoring_status. Empty until our notewriter qualifies for has_access on the API.';
