-- Add a 'claude' kind to everything_pipeline_runs (GOO-612).
--
-- The Claude note writer on Nathan's ai-box now writes one row per post it
-- worked on, with the post's A/B picks in ab_test_picks, the same way the
-- pipeline writes one row per claim. So the same readouts can compare the arms
-- of the Claude note writer's prompt.
--
-- These rows leave the cost column empty. The daily spend cap adds that column
-- up in dollars, and Claude spends the usage of Nathan's plan, not money. What
-- the run would have cost on the API is in logs->costUsd.

alter table everything_pipeline_runs
  drop constraint everything_pipeline_runs_kind_check;

alter table everything_pipeline_runs
  add constraint everything_pipeline_runs_kind_check
  check (kind in ('check', 'extraction', 'rating', 'other', 'claude'));

comment on column everything_pipeline_runs.kind is
  'check = one fact-check of one claim, the row shape this table always held. extraction = the claim extraction of one item. rating = the web-research rating of one item''s claims. other = a smaller cost of one item, named in the outcome column (for example capture_cleanup). The middle three are recorded so the daily spend cap counts them. claude = one post the Claude note writer worked on, with its A/B picks and no cost.';
