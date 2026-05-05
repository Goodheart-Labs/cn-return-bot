-- Split pipeline_runs.bot_id into three columns.
--
-- bot_id today encodes both the bot family and the config variant in one
-- string (e.g. "claude-simple_claude-simple-sonnet-gemini"). That makes it
-- impossible to group runs by family without string-splitting at every read.
--
-- After this migration:
--   bot_name      — short family name ("claude-simple", "multi-agent")
--   bot_name_long — current bot_id verbatim (family_variant)
--   bot_config    — JSONB snapshot of the BotConfig used for the run
--                   (NULL for historical rows; populated going forward)

-- Rename bot_id → bot_name_long so existing readers keep working with
-- minimal code surgery (they all want the variant-encoded form for
-- per-variant grouping).
ALTER TABLE pipeline_runs RENAME COLUMN bot_id TO bot_name_long;

ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS bot_name TEXT,
  ADD COLUMN IF NOT EXISTS bot_config JSONB;

-- Backfill the short name from the existing variant-encoded id.
-- "claude-simple_claude-simple-sonnet-gemini" → "claude-simple"
-- "multi-agent_gemini-flash-perplexity"      → "multi-agent"
UPDATE pipeline_runs
  SET bot_name = split_part(bot_name_long, '_', 1)
  WHERE bot_name IS NULL AND bot_name_long IS NOT NULL;

-- Replace the old bot_id index with one on each of the new columns.
DROP INDEX IF EXISTS idx_pipeline_runs_bot_id;
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_bot_name ON pipeline_runs(bot_name);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_bot_name_long ON pipeline_runs(bot_name_long);
