/** Dumps the X bot's pipeline_runs of the last 7 days (outcome and error only),
 *  to see how often a single tweet errors inside an otherwise healthy run. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const LOOKBACK_DAYS = 7;
const PAGE_SIZE = 1000;
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
const rows: any[] = [];
for (let from = 0; ; from += PAGE_SIZE) {
  const { data, error } = await db
    .from("pipeline_runs")
    .select("id, created_at, outcome, outcome_reason, error_message, final_stage")
    .gte("created_at", since)
    .order("id")
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  rows.push(...data);
  if (data.length < PAGE_SIZE) break;
}
writeFileSync(new URL("./xbot_runs.json", import.meta.url), JSON.stringify(rows));
console.log(`${rows.length} pipeline_runs since ${since}`);
