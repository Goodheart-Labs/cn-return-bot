-- Pipeline tracking tables
-- Track every tweet that enters the pipeline and its journey to outcome

-- Main table: one row per tweet processed
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tweet info
  tweet_id TEXT NOT NULL,
  author_id TEXT,
  tweet_text TEXT,

  -- Media info
  has_video BOOLEAN DEFAULT FALSE,
  has_photo BOOLEAN DEFAULT FALSE,
  media_count INTEGER DEFAULT 0,
  video_duration_ms INTEGER,

  -- Processing info
  bot_id TEXT,

  -- Outcome tracking
  outcome TEXT NOT NULL,  -- 'submitted', 'filtered', 'failed', 'rejected'
  outcome_reason TEXT,    -- semantic category: 'video_cap', 'low_score', 'check_failed', 'bot_error', 'no_correction_needed', etc.
  error_message TEXT,     -- actual error text when outcome is 'failed'
  final_stage TEXT,       -- 'filtering', 'search', 'note_writing', 'check', 'evaluation', 'submission'

  -- Link to notes table if submitted
  note_id TEXT,

  -- Metadata
  commit_sha TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Scores table: flexible scoring attached to pipeline runs
CREATE TABLE IF NOT EXISTS pipeline_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,

  score_type TEXT NOT NULL,   -- 'evaluation', 'check', 'confidence', etc.
  score_value NUMERIC,        -- numeric score (nullable for non-numeric scores)
  score_label TEXT,           -- text result like 'YES'/'NO' for check
  score_metadata JSONB,       -- flexible extra info

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for pipeline_runs
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_tweet_id ON pipeline_runs(tweet_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_outcome ON pipeline_runs(outcome);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_final_stage ON pipeline_runs(final_stage);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_created_at ON pipeline_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_bot_id ON pipeline_runs(bot_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_has_video ON pipeline_runs(has_video) WHERE has_video = TRUE;

-- Indexes for pipeline_scores
CREATE INDEX IF NOT EXISTS idx_pipeline_scores_run_id ON pipeline_scores(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_scores_type ON pipeline_scores(score_type);

-- Comments
COMMENT ON TABLE pipeline_runs IS 'Tracks every tweet that enters the pipeline and its outcome';
COMMENT ON COLUMN pipeline_runs.outcome IS 'Final outcome: submitted, filtered, failed, rejected';
COMMENT ON COLUMN pipeline_runs.outcome_reason IS 'Semantic category for outcome (e.g., video_cap, low_score, check_failed, bot_error)';
COMMENT ON COLUMN pipeline_runs.error_message IS 'Actual error text when outcome is failed (stack traces, API errors, etc.)';
COMMENT ON COLUMN pipeline_runs.final_stage IS 'Last pipeline stage reached: filtering, search, note_writing, check, evaluation, submission';

COMMENT ON TABLE pipeline_scores IS 'Scores and evaluations attached to pipeline runs';
COMMENT ON COLUMN pipeline_scores.score_type IS 'Type of score: evaluation, check, confidence, etc.';
COMMENT ON COLUMN pipeline_scores.score_value IS 'Numeric score value (if applicable)';
COMMENT ON COLUMN pipeline_scores.score_label IS 'Text label like YES/NO (if applicable)';
