/* How long Claude runs take per kind over the last 7 days, to size the deploy freeze and the time limits (GOO-787). */
import { getSupabaseClient } from "../../api/supabaseClient";
import { fetchAllRows } from "../../everything-core/paging";

const since = "2026-10-20";
const rows = await fetchAllRows<{ id: string; started_at: string; ended_at: string; tags: string[]; api_cost_usd: number | null }>(
  () => getSupabaseClient().from("everything_claude_runs").select("id, started_at, ended_at, tags, api_cost_usd").gte("started_at", since).not("api_cost_usd", "is", null).like("run_dir", "%tmp/cn-notes%"),
  "id",
  { label: "runs" },
);
const byTag = new Map<string, number[]>();
for (const r of rows) {
  const minutes = (Date.parse(r.ended_at) - Date.parse(r.started_at)) / 60_000;
  const tag = r.tags.join(",");
  byTag.set(tag, [...(byTag.get(tag) ?? []), minutes]);
}
const q = (xs: number[], p: number) => xs.sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!.toFixed(0);
for (const [tag, xs] of byTag) console.log(tag, `n=${xs.length}`, `median=${q(xs, 0.5)}`, `p90=${q(xs, 0.9)}`, `p99=${q(xs, 0.99)}`, `max=${q(xs, 1)}`);
