/* Prints the shape of logs.costs of one recent and one August pipeline run, to
 * find where the per-step costs are stored. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
for (const day of ["2026-08-05", "2026-11-03"]) {
  const r = await db.from("pipeline_runs").select("id, cost, costs:logs->costs")
    .eq("bot_name", "simple-bot").eq("outcome_reason", "no_correction_needed")
    .gte("created_at", `${day}T10:00:00Z`).lt("created_at", `${day}T12:00:00Z`).limit(1);
  if (r.error) throw r.error;
  console.log(day, JSON.stringify(r.data[0], null, 1).slice(0, 3000));
}
