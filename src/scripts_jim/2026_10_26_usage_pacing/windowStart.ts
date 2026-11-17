/* Finds when the usage readings of Nathan's plan begin, and how many posts
 * Claude took before and after, to pick where the usage window may start. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const first = await db.from("everything_claude_usage").select("at, weekly, weekly_resets_at").not("weekly_resets_at", "is", null).order("at").limit(3);
console.log("first readings with a reset time", first.data);
const lastNull = await db.from("everything_claude_usage").select("at, weekly").is("weekly_resets_at", null).order("at", { ascending: false }).limit(1);
console.log("last reading without one", lastNull.data);
for (const [from, to] of [["2026-10-19", "2026-10-24T05:30Z"], ["2026-10-24T05:30Z", "2026-10-27"]]) {
  const { count } = await db.from("everything_claude_events").select("id", { count: "exact", head: true }).eq("type", "item_taken").gte("at", from).lt("at", to);
  console.log(`takes ${from} to ${to}:`, count);
}
