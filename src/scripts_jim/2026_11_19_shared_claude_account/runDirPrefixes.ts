/* The run folder prefixes in everything_claude_runs, to backfill which notewriter each run belongs to (GOO-787). */
import { getSupabaseClient } from "../../api/supabaseClient";
import { fetchAllRows } from "../../everything-core/paging";

const rows = await fetchAllRows<{ id: string; run_dir: string; started_at: string }>(
  () => getSupabaseClient().from("everything_claude_runs").select("id, run_dir, started_at"),
  "id",
  { label: "runs" },
);
const prefixes = new Map<string, { n: number; first: string; last: string }>();
for (const r of rows) {
  const prefix = r.run_dir.split("/").slice(0, 5).join("/");
  const p = prefixes.get(prefix) ?? { n: 0, first: r.started_at, last: r.started_at };
  p.n++;
  if (r.started_at < p.first) p.first = r.started_at;
  if (r.started_at > p.last) p.last = r.started_at;
  prefixes.set(prefix, p);
}
for (const [prefix, p] of prefixes) console.log(p.n, p.first.slice(0, 16), p.last.slice(0, 16), prefix);
