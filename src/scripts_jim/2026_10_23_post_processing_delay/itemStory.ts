/* Everything that happened to one item, in time order: its row, the Claude
 * note writer's events, hand-backs and pipeline runs (GOO-549).
 *   bun run src/scripts_jim/2026_10_23_post_processing_delay/itemStory.ts <title words> */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data: items, error } = await db.from("everything_items").select("id, url, title, status, priority, retries, checked_scope, skip_reason, error, published_at, created_at, processed_at").ilike("title", `%${process.argv[2]}%`);
if (error) throw error;
for (const item of items!) {
  console.log(JSON.stringify(item, null, 1));
  const { data: events } = await db.from("everything_claude_events").select("at, actor, type, data").eq("item_id", item.id).order("at");
  const { data: handbacks } = await db.from("everything_claude_handbacks").select("*").eq("item_id", item.id);
  const { data: runs } = await db.from("everything_pipeline_runs").select("created_at, kind, outcome").eq("item_id", item.id).order("created_at");
  console.log("handbacks", JSON.stringify(handbacks));
  for (const e of events ?? []) console.log(e.at.slice(0, 19), e.actor, e.type, JSON.stringify(e.data).slice(0, 160));
  const byKind = new Map<string, string[]>();
  for (const r of runs ?? []) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r.created_at.slice(0, 16)]);
  for (const [kind, times] of byKind) console.log(`runs ${kind}: ${times.length}, first ${times[0]}, last ${times.at(-1)}`);
}
