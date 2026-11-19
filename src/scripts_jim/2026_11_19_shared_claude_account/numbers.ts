/* Numbers for the GOO-787 plan: X tweets per day and how many drew Claude, Claude run costs by tag, and the latest usage readings. */
import { getSupabaseClient } from "../../api/supabaseClient";
import { fetchAllRows } from "../../everything-core/paging";

const db = getSupabaseClient();
const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

const runs = await fetchAllRows<{ id: string; created_at: string; bot_name: string | null; outcome: string | null; outcome_reason: string | null; final_stage: string | null }>(
  () => db.from("pipeline_runs").select("id, created_at, bot_name, outcome, outcome_reason, final_stage").gte("created_at", since),
  "id",
  { label: "runs" },
);
const perDay = new Map<string, Record<string, number>>();
for (const r of runs) {
  const day = r.created_at.slice(0, 10);
  const row = perDay.get(day) ?? {};
  row.all = (row.all ?? 0) + 1;
  const key = r.bot_name === "claude-code" ? `claude:${r.outcome}:${r.outcome_reason ?? ""}` : `${r.bot_name}`;
  row[key] = (row[key] ?? 0) + 1;
  perDay.set(day, row);
}
for (const [day, row] of [...perDay].sort()) console.log(day, JSON.stringify(row));

const claudeRuns = await fetchAllRows<{ id: string; started_at: string; tags: string[]; api_cost_usd: number | null }>(
  () => db.from("everything_claude_runs").select("id, started_at, tags, api_cost_usd").gte("started_at", since),
  "id",
  { label: "claudeRuns" },
);
const byTag = new Map<string, { n: number; withCost: number; cost: number }>();
for (const r of claudeRuns) {
  const tag = r.tags.join(",");
  const t = byTag.get(tag) ?? { n: 0, withCost: 0, cost: 0 };
  t.n++;
  if (r.api_cost_usd) { t.withCost++; t.cost += Number(r.api_cost_usd); }
  byTag.set(tag, t);
}
console.log(Object.fromEntries(byTag));

const { data: usage } = await db.from("everything_claude_usage").select("*").order("at", { ascending: false }).limit(3);
console.log(usage);
