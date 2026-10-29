-- Add a 'claude' kind to everything_pipeline_runs, and link each Claude draft
-- to its run (GOO-612).
--
-- The Claude note writer on Nathan's ai-box now writes one row per post it
-- works on, with the post's A/B picks in ab_test_picks, the same way the
-- pipeline writes one row per claim. So the same readouts can compare the arms
-- of the Claude note writer's prompt. The runner writes the row when it starts
-- the Claude, with the outcome 'running', and fills in the outcome when the
-- Claude ends.
--
-- Every draft that Claude saves carries the id of that row in run_id. So a
-- draft's arm is one join away, even on a post that was checked twice. Drafts
-- saved before this migration have none.
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

alter table everything_claude_drafts
  add column run_id uuid references everything_pipeline_runs (id) on delete set null;

comment on column everything_claude_drafts.run_id is
  'The everything_pipeline_runs row (kind claude) of the Claude run that saved this draft. Its ab_test_picks say which prompt the Claude had.';
