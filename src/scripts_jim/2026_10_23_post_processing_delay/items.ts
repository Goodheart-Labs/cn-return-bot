/* Dumps the recent items of the walked creators with every timestamp we have,
 * so the delay from publication to a finished check can be split into its parts. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SINCE = "2026-10-01";

const { data: items, error } = await db
  .from("everything_items")
  .select("id, project_id, source, url, title, published_at, status, priority, retries, checked_scope, skip_reason, created_at, processed_at, error, project:everything_projects(slug, name, feed_url, priority_until)")
  .gte("created_at", SINCE)
  .order("created_at");
if (error) throw error;
const { data: events, error: e2 } = await db
  .from("everything_claude_events")
  .select("item_id, type, at")
  .in("type", ["item_taken", "item_finished", "handed_back", "item_skipped"]);
if (e2) throw e2;
const { data: settings } = await db.from("everything_claude_settings").select("*");
const { data: schedule } = await db.from("everything_feed_schedule").select("*");
writeFileSync(new URL("./items.json", import.meta.url), JSON.stringify({ items, events, settings, schedule }, null, 1));
console.log(items!.length, "items", events!.length, "events");
console.log(JSON.stringify(settings), JSON.stringify(schedule));
