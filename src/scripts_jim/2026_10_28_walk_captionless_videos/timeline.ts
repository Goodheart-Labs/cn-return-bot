/**
 * GOO-602: for two videos that ended as "no captions" on 2026-10-27, when the
 * walk picked them, when Claude handed them back, the next picks, and the
 * posts Claude took around them.
 *
 *   bun run src/scripts_jim/2026_10_28_walk_captionless_videos/timeline.ts
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
for (const v of ["9zymFlzwPlo", "1jhLeojANZc"]) {
  const { data: [item] } = await db.from("everything_items").select("id, created_at, processed_at, status, skip_reason").like("url", `%${v}%`);
  const { data: hb } = await db.from("everything_claude_handbacks").select("*").eq("item_id", item!.id);
  console.log(v, item, hb);
  const t = Date.parse(item!.created_at);
  const { data: next } = await db.from("everything_items").select("url, created_at, priority, source").lt("priority", 2).gt("created_at", item!.created_at).lt("created_at", new Date(t + 6 * 3600e3).toISOString()).order("created_at").limit(4);
  console.log(" next picks:", next);
  const { data: taken } = await db.from("everything_claude_events").select("at, type, item_id").gte("at", new Date(t - 3 * 3600e3).toISOString()).lt("at", new Date(t + 6 * 3600e3).toISOString()).eq("type", "item_taken").order("at");
  console.log(" takes:", taken?.map((e) => e.at.slice(11, 16) + " " + e.item_id.slice(0, 8)).join(", "));
}
