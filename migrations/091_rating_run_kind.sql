-- Count the claim-rating step in the daily spend cap (GOO-88).
--
-- Main split extraction into two steps: extracting the claims, then rating
-- them with web research to decide which are worth a fact-check. The rating
-- call costs real money, so it writes an everything_pipeline_runs row the same
-- way extraction does. The kind check from migration 088 has to allow it.

alter table everything_pipeline_runs
  drop constraint everything_pipeline_runs_kind_check;

alter table everything_pipeline_runs
  add constraint everything_pipeline_runs_kind_check
  check (kind in ('check', 'extraction', 'rating'));

comment on column everything_pipeline_runs.kind is
  'check = one fact-check of one claim, the row shape this table always held. extraction = the claim extraction of one item. rating = the web-research rating of one item''s claims. The last two are recorded so the daily spend cap counts them.';
