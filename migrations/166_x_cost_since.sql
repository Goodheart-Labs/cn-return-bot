-- 166: the X bot stops checking new tweets once it has spent 30 dollars in a
-- UTC day (GOO-698). Each X run asks this function what the bot has spent
-- since midnight. It sums the LLM cost of every pipeline_runs row since then,
-- so a run reads one number instead of every row of the day. The index on
-- pipeline_runs.created_at from migration 006 keeps the read to today's rows.
-- Apply this before the PR is merged, because the X run calls it from then on.

create or replace function x_cost_since(since timestamptz)
returns numeric
language sql
stable
as $$
  select coalesce(sum(cost), 0) from pipeline_runs where created_at >= since;
$$;

-- Revoking public also strips service_role's inherited execute, so it is
-- granted back explicitly. The X run is the only caller.
revoke execute on function x_cost_since(timestamptz) from public, anon, authenticated;
grant execute on function x_cost_since(timestamptz) to service_role;

notify pgrst, 'reload schema';
