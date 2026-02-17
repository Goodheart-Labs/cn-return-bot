import "dotenv/config";
import { getSupabaseClient } from "../src/api/supabaseClient";
const s = getSupabaseClient();

for (const table of ["notes", "pipeline_runs", "pipeline_scores", "scraped_notewriter_notes", "scraped_notewriter_snapshots", "public_data_snapshots"]) {
  const { count, error } = await s.from(table).select("*", { count: "exact", head: true });
  console.log(`${table}: ${count} rows${error ? ` (error: ${error.message})` : ""}`);
}
