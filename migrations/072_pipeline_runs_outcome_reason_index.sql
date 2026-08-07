-- Review dashboard's low-eval pill count and low-eval-runs list both filter
-- pipeline_runs by outcome_reason (+ created_at window). With no index that is
-- a seq scan over 100k+ fat JSONB rows, which crossed Supabase's 8s statement
-- timeout on 2026-07-28 ("canceling statement due to statement timeout").
-- ALREADY APPLIED to prod 2026-07-28 via psql (CREATE INDEX CONCURRENTLY);
-- kept here so the schema history records it. IF NOT EXISTS makes re-runs safe.
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_outcome_reason_created_at
  ON pipeline_runs (outcome_reason, created_at);
