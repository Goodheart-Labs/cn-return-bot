-- Non-fatal warnings collected during a pipeline run.
--
-- Previously, transient sub-step failures (notably media analysis 503s caught
-- per item in mediaAnalysisGemini) were only `console.error`-logged to GitHub
-- Actions stdout and never persisted — a note would ship with a silently
-- un-analyzed image and nothing flagged it. Warnings used to be folded into
-- `error_message`; they now live in their own column so `error_message` stays
-- errors-only and warnings are queryable on their own.
--
-- Examples: "Image analysis: Gemini failed, used Claude Haiku fallback (<url>)",
-- "Video analysis failed: <reason>".
--
-- NULL/empty when the run had no warnings. Populated only for runs after deploy.

ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS warnings TEXT[];

COMMENT ON COLUMN pipeline_runs.warnings IS
  'Non-fatal warnings collected during the run (e.g. media analysis Haiku fallback used, video analysis failed). NULL when none.';
