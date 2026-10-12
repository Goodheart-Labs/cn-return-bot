/** Every feed or requested item worked since a given time, with how it ended,
 *  how long it took and what it cost. Names columns only, no large text. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const since = process.argv[2] ?? "2026-09-17T14:40:00Z";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data: items, error } = await db
  .from("everything_items")
  .select("id, url, title, source, status, priority, retries, started_at, processed_at, skip_reason, error")
  .gte("started_at", since)
  .order("started_at");
if (error) throw error;
for (const i of items!) {
  const minutes = i.processed_at && i.started_at ? ((Date.parse(i.processed_at) - Date.parse(i.started_at)) / 60000).toFixed(1) : "-";
  const { data: claims } = await db.from("everything_claims").select("status").eq("item_id", i.id);
  const notes = (claims ?? []).filter((c) => c.status === "note").length;
  const outcome = i.status === "error" ? `ERROR ${(i.error ?? "").slice(0, 70)}` : i.skip_reason ? `gated: ${i.skip_reason.slice(0, 60)}` : i.status;
  console.log(`${i.started_at.slice(11, 16)} ${minutes.padStart(5)}m p${i.priority} ${i.source.padEnd(9)} notes=${String(notes).padStart(2)} ${outcome.padEnd(40)} ${(i.title ?? i.url).slice(0, 50)}`);
}
