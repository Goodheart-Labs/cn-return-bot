-- 194: what each Claude run used, next to what it cost (GOO-837).
--
-- everything_claude_runs had only the cost of a run. The transcript that shows
-- how the Claude spent it stayed in the run folder on the ai-box, which the
-- runner deleted after 3 days (30 days from this change on). These columns
-- keep a summary of every run, so runs can be compared by model, turns and tool
-- use long after their transcripts are gone. Rows written before this
-- migration, and rows from a runner on older code, leave them null.
--
-- UNDO: alter table everything_claude_runs drop column model, drop column turns,
--         drop column tool_calls, drop column subagent_calls, drop column model_usage;

alter table everything_claude_runs
  add column model text,
  add column turns integer,
  add column tool_calls jsonb,
  add column subagent_calls integer,
  add column model_usage jsonb;

comment on column everything_claude_runs.model is
  'The model the Claude ran on, as Claude Code names it, for example claude-opus-5-5.';
comment on column everything_claude_runs.turns is
  'How many turns the Claude took, as Claude Code counts them.';
comment on column everything_claude_runs.tool_calls is
  'How often the Claude itself called each tool, as {"WebSearch": 3, ...}. Calls of its subagents are not in it.';
comment on column everything_claude_runs.subagent_calls is
  'How many subagents the Claude started.';
comment on column everything_claude_runs.model_usage is
  'Claude Code''s modelUsage: tokens (input, output, cache reads and writes) and cost per model, subagents included.';

notify pgrst, 'reload schema';
