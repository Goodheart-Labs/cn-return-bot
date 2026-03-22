-- Store the full TweetLogMap as JSON for each pipeline run
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS logs JSONB;
