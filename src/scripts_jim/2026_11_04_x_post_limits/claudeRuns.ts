/* Lists the Claude runs tagged x since 2 Nov, and the latest usage readings, to
 * see why the Claude X tweets stopped finishing on 2 Nov at 16:00. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const runs = await db.from("everything_claude_runs").select("*").gte("created_at", "2026-11-02T10:00:00Z").order("created_at").limit(500);
if (runs.error) throw runs.error;
const byHour: Record<string, Record<string, number>> = {};
for (const r of runs.data) {
  const h = String(r.created_at).slice(0, 13);
  const tag = (r.tags ?? []).join(",");
  byHour[h] ??= {};
  byHour[h][tag] = (byHour[h][tag] ?? 0) + 1;
}
console.log(Object.keys(runs.data[0] ?? {}).join(", "));
for (const [h, t] of Object.entries(byHour)) console.log(h, JSON.stringify(t));
const usage = await db.from("everything_claude_usage").select("*").order("at", { ascending: false }).limit(3);
console.log(usage.data);
