/* Downloads the per-step costs (logs.costs.groups) of every simple-bot run
 * since July. Writes groups.json next to this file. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import { fetchAllRows } from "../../everything-core/paging";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const rows = await fetchAllRows(
  () => db.from("pipeline_runs").select("id, groups:logs->costs->groups")
    .eq("bot_name", "simple-bot").gte("created_at", "2026-07-01T00:00:00Z"),
  "id",
  { label: "groups" },
);
writeFileSync(`${import.meta.dir}/groups.json`, JSON.stringify(rows));
console.log(rows.length, "rows");
