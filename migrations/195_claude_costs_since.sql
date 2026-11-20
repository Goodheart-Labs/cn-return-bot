-- 195: what a notewriter's Claude runs cost since a moment, per kind of run
-- (GOO-831).
--
-- The usage pacing of the Claude note writer turns the API cost that Claude
-- Code reports for every run into the share of the weekly limit it used. It
-- needs the sum of a week of runs, split by their tags. A week has several
-- thousand runs, mostly note judges, and the runner asks every 5 minutes. So
-- the database adds them up and returns one row per set of tags instead of
-- every run. Runs that died before Claude Code reported a cost are left out.
-- The index serves this read and the X share's read of the week's runs
-- (src/claude-notes/usageShare.ts).
--
-- Apply this before the PR is merged, because the runner on ai-box calls the
-- function as soon as it deploys the merge.
--
-- UNDO: drop function everything_claude_costs_since(text, timestamptz);
--       drop index everything_claude_runs_notewriter_started_at;

create index everything_claude_runs_notewriter_started_at
  on everything_claude_runs (notewriter, started_at);

create or replace function everything_claude_costs_since(p_notewriter text, p_since timestamptz)
returns table (tags text[], runs bigint, api_cost_usd numeric)
language sql
stable
as $$
  select r.tags, count(*), sum(r.api_cost_usd)
  from everything_claude_runs r
  where r.notewriter = p_notewriter
    and r.started_at >= p_since
    and r.api_cost_usd is not null
  group by r.tags;
$$;

-- Revoking public also strips service_role's inherited execute, so it is
-- granted back explicitly. The runner is the only caller.
revoke execute on function everything_claude_costs_since(text, timestamptz) from public, anon, authenticated;
grant execute on function everything_claude_costs_since(text, timestamptz) to service_role;

notify pgrst, 'reload schema';
