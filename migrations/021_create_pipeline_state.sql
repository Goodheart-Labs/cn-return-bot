-- Key-value store for persistent pipeline state across runs
-- Used for feed size strategy, rate limit tracking, etc.
CREATE TABLE IF NOT EXISTS pipeline_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Track which feed size was used per run
ALTER TABLE run_snapshots ADD COLUMN IF NOT EXISTS feed_size TEXT;
