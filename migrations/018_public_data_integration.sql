-- Add public data fields to canonical_note_information
-- These come from CN's daily public data dumps (notes + noteStatusHistory files)

-- From noteStatusHistory: richer status info
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS current_core_status TEXT;
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS current_expansion_status TEXT;
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS current_group_status TEXT;
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS current_decided_by TEXT;
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS current_modeling_group TEXT;
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS first_non_nmr_status TEXT;
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS most_recent_non_nmr_status TEXT;
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS locked_status TEXT;

-- Timestamps from noteStatusHistory
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS first_non_nmr_at TIMESTAMPTZ;
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS status_locked_at TIMESTAMPTZ;

-- From notes file: classification metadata
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS classification TEXT;

-- Tracking when public data last updated this row
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS public_data_updated_at TIMESTAMPTZ;

-- Rating aggregates (from ratings files)
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 0;
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS helpful_count INTEGER DEFAULT 0;
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS not_helpful_count INTEGER DEFAULT 0;
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS top_helpful_tag TEXT;
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS top_not_helpful_tag TEXT;
ALTER TABLE canonical_note_information ADD COLUMN IF NOT EXISTS ratings_updated_at TIMESTAMPTZ;

-- Competing notes table: other notes on same tweets as ours
CREATE TABLE IF NOT EXISTS competing_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tweet_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  our_note_id TEXT NOT NULL REFERENCES canonical_note_information(note_id),
  author_participant_id TEXT,
  note_text TEXT,
  classification TEXT,
  current_status TEXT,
  current_core_status TEXT,
  current_decided_by TEXT,
  created_at_millis BIGINT,
  rating_count INTEGER DEFAULT 0,
  helpful_count INTEGER DEFAULT 0,
  not_helpful_count INTEGER DEFAULT 0,
  first_seen_date TEXT,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(note_id, our_note_id)
);

CREATE INDEX IF NOT EXISTS idx_competing_notes_tweet ON competing_notes(tweet_id);
CREATE INDEX IF NOT EXISTS idx_competing_notes_our_note ON competing_notes(our_note_id);
CREATE INDEX IF NOT EXISTS idx_competing_notes_status ON competing_notes(current_status);
