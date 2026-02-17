import "dotenv/config";
import { getSupabaseClient } from "../src/api/supabaseClient";
const s = getSupabaseClient();

// Check pipeline runs for current active bots
for (const bot of ["opus-4.6", "opus-main", "opus-research", "kimi-k2", "sonar-pro"]) {
  const { count } = await s.from("pipeline_runs").select("*", { count: "exact", head: true }).eq("bot_id", bot);
  const { count: submitted } = await s.from("pipeline_runs").select("*", { count: "exact", head: true }).eq("bot_id", bot).eq("outcome", "submitted");
  const { count: noteCount } = await s.from("notes").select("*", { count: "exact", head: true }).eq("bot_name", bot);
  console.log(`${bot}: ${count} pipeline runs, ${submitted} submitted, ${noteCount} in notes table`);
}

// Check what bot_names exist in notes table
const { data: botNames } = await s.from("notes").select("bot_name");
const counts = new Map<string, number>();
for (const n of botNames || []) {
  const name = n.bot_name || "unknown";
  counts.set(name, (counts.get(name) || 0) + 1);
}
console.log("\nBot names in notes table:", Object.fromEntries(counts));
