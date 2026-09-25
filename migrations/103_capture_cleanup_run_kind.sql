-- Count the capture cleanup in the daily spend cap (GOO-245).
--
-- When a reader requests notes on a page, the extension sends the page's text,
-- and one Gemini Flash call strips it down to the article before it is queued
-- (src/everything/pipeline/cleanCapturedText.ts). That call costs money but was
-- never written down, so the daily spend cap did not see it. It now writes an
-- everything_pipeline_runs row of kind 'capture', like extraction and rating
-- do. The kind check from migration 091 has to allow it.
--
-- Pacing is unaffected: it averages the cost of feed posts only, and a capture
-- row belongs to a reader-requested page.

alter table everything_pipeline_runs
  drop constraint everything_pipeline_runs_kind_check;

alter table everything_pipeline_runs
  add constraint everything_pipeline_runs_kind_check
  check (kind in ('check', 'extraction', 'rating', 'capture'));

comment on column everything_pipeline_runs.kind is
  'check = one fact-check of one claim, the row shape this table always held. extraction = the claim extraction of one item. rating = the web-research rating of one item''s claims. capture = the cleanup of the page text a reader request carried. The last three are recorded so the daily spend cap counts them.';
