import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const tables = ["everything_projects","everything_items","everything_claims","everything_notes","everything_note_sources","everything_votes","everything_note_suggestions"];
for (const t of tables) {
  const { data, error, count } = await sb.from(t).select("*", { count: "exact" }).limit(1);
  if (error) { console.log(`${t}: ERROR ${error.message}`); continue; }
  console.log(`\n${t}: ${count} rows; columns: ${data && data[0] ? Object.keys(data[0]).join(", ") : "(empty)"}`);
}
