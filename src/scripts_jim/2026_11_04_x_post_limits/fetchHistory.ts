/* Downloads the few columns of every X pipeline_runs row since April that the
 * weekly cost-per-note table needs. Writes history.json next to this file. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import { fetchAllRows } from "../../everything-core/paging";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const rows = await fetchAllRows(
  () => db.from("pipeline_runs")
    .select("id, created_at, outcome, outcome_reason, bot_name, cost")
    .gte("created_at", "2026-04-01T00:00:00Z"),
  "id",
  { label: "history" },
);
writeFileSync(`${import.meta.dir}/history.json`, JSON.stringify(rows));
console.log(rows.length, "rows");
