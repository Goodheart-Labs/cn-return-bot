-- Lightweight per-run metrics table
-- One row per cron run (~48/day), tracks backlog size over time
CREATE TABLE IF NOT EXISTS run_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  backlog_total int NOT NULL,        -- eligible tweets from API (up to 200)
  backlog_new int NOT NULL,          -- never-seen-before tweets
  backlog_retry int NOT NULL,        -- previously attempted, not resolved
  backlog_hit_limit boolean DEFAULT false, -- true if we hit the 200 cap
  posts_processed int NOT NULL,      -- how many we actually processed this run
  commit_sha text
);

-- Index for time-series queries
CREATE INDEX idx_run_snapshots_created_at ON run_snapshots (created_at);
