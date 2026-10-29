-- The Claude runs on Nathan's ai-box (GOO-612): a ledger of every run with
-- its API-equivalent cost, a 'claude' kind for everything_pipeline_runs, and a
-- link from each Claude draft to its run.
--
-- everything_claude_runs has one row per Claude run the runner on ai-box
-- started: a post's Claude, an X tweet's Claude, a note judge, a reviewer
-- answer. A retry is a row of its own. Each row has tags that say what the run
-- was for, such as {common-notes,post} or {x,tweet}, and what the run would
-- have cost on the API, as Claude Code reports it. Nathan's plan only reports
-- its total usage, so src/claude-notes/usageShare.ts splits that total by
-- these costs: a tag's share of the week is the week's rise in usage times the
-- tag's part of all costs. The X note writer's limit is one such share.
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
-- the run would have cost on the API is in its everything_claude_runs rows.

create table everything_claude_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  ended_at timestamptz not null default now(),
  tags text[] not null check (cardinality(tags) > 0),
  -- What the run would have cost on the API, in USD. Null when the run died
  -- before Claude Code reported it.
  api_cost_usd numeric,
  -- The run's folder on ai-box, with its prompt and Claude Code's output.
  run_dir text not null,
  -- What the run was for. At most one is set.
  pipeline_run_id uuid references pipeline_runs (id) on delete set null,
  everything_pipeline_run_id uuid references everything_pipeline_runs (id) on delete set null,
  draft_id uuid references everything_claude_drafts (id) on delete set null
);
create index everything_claude_runs_ended_at on everything_claude_runs (ended_at);

-- Internal: only the service key reads and writes it.
alter table everything_claude_runs enable row level security;

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
