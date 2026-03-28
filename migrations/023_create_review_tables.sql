-- Review Dashboard tables
-- Used by the note review dashboard for annotations, failure modes, and dataset run uploads.

CREATE TABLE IF NOT EXISTS review_dashboard_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS review_dashboard_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES review_dashboard_uploads(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  tweet_text TEXT,
  needs_note TEXT,
  ground_truth_note TEXT,
  bot_id TEXT,
  note_status TEXT,
  outcome TEXT,
  result TEXT,
  note_text TEXT,
  source_verification TEXT,
  evaluation_score NUMERIC,
  logs JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_dashboard_items_upload ON review_dashboard_items(upload_id);

CREATE TABLE IF NOT EXISTS review_dashboard_failure_modes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS review_dashboard_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('production', 'dataset_run')),
  target_id TEXT NOT NULL,
  seen BOOLEAN NOT NULL DEFAULT FALSE,
  failure_modes TEXT[] NOT NULL DEFAULT '{}',
  comment TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source, target_id)
);
