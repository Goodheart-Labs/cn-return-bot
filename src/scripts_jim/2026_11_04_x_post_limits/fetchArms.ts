/* Downloads, for every X pipeline_runs row since May, the A/B arms that pick
 * the expensive models: the search model, the writer, the search cascade and
 * the second round. Writes arms.json next to this file. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import { fetchAllRows } from "../../everything-core/paging";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const rows = await fetchAllRows(
  () => db.from("pipeline_runs")
    .select("id, search:ab_test_picks->>simple_bot_search, writer:ab_test_picks->>simple_bot_writer, cascade:ab_test_picks->>search_cascade, second:ab_test_picks->>second_round, prefilter:ab_test_picks->>note_prefilter")
    .gte("created_at", "2026-05-01T00:00:00Z"),
  "id",
  { label: "arms" },
);
writeFileSync(`${import.meta.dir}/arms.json`, JSON.stringify(rows));
console.log(rows.length, "rows");
