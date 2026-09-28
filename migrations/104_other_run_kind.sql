-- Add an 'other' kind to everything_pipeline_runs for small per-item costs (GOO-245).
--
-- The daily spend cap sums the cost column of this table, so a cost only counts
-- if some row carries it. Extraction and rating each have their own kind. Smaller
-- costs that belong to an item do not deserve a kind of their own each, so they
-- share the kind 'other', and the outcome column says what the money was for.
--
-- The first such cost is the capture cleanup: when a reader requests notes on a
-- page, one Gemini Flash call strips the page text the extension captured down to
-- the article (src/everything/pipeline/cleanCapturedText.ts). That call was never
-- written down. It now writes a row with kind 'other' and outcome
-- 'capture_cleanup'. The kind check from migration 091 has to allow 'other'.
--
-- Pacing is unaffected: it averages the cost of feed posts only, and a capture
-- cleanup always belongs to a reader-requested page.

alter table everything_pipeline_runs
  drop constraint everything_pipeline_runs_kind_check;

alter table everything_pipeline_runs
  add constraint everything_pipeline_runs_kind_check
  check (kind in ('check', 'extraction', 'rating', 'other'));

comment on column everything_pipeline_runs.kind is
  'check = one fact-check of one claim, the row shape this table always held. extraction = the claim extraction of one item. rating = the web-research rating of one item''s claims. other = a smaller cost of one item, named in the outcome column (for example capture_cleanup). The last three are recorded so the daily spend cap counts them.';
