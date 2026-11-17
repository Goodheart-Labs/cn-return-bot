/* Reads what the Claude note writer has cost in Nathan's weekly usage since it
 * moved to ai-box: the usage readings, every finished post with its usage at
 * start and end, the hand-backs, and the current settings. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SINCE = "2026-10-23T00:00:00Z";

const usage = await db.from("everything_claude_usage").select("*").gte("at", SINCE).order("at").limit(5000);
if (usage.error) throw usage.error;
const events = await db
  .from("everything_claude_events")
  .select("item_id, type, at, data")
  .in("type", ["item_taken", "item_finished", "handed_back", "item_skipped", "settings_changed"])
  .gte("at", SINCE)
  .order("at")
  .limit(5000);
if (events.error) throw events.error;
const settings = await db.from("everything_claude_settings").select("*");
writeFileSync(new URL("./history.json", import.meta.url), JSON.stringify({ usage: usage.data, events: events.data, settings: settings.data }, null, 1));
console.log(usage.data.length, "usage readings", events.data.length, "events");
console.log(JSON.stringify(settings.data));
