/**
 * Gives every YouTube item that was wrongly recorded as "No transcript
 * available" one more attempt (GOO-169). Those errors were the residential
 * proxy failing to reach YouTube, not videos without captions. Run once after
 * the caption fix is on main. The items go back to the queue with their retry
 * count reset, so a video that really has no captions ends in error again
 * after the usual three attempts.
 *
 *   bun run src/scripts_jim/2026_09_16_common_notes_bottleneck/requeueNoTranscript.ts [--dry-run]
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const dryRun = process.argv.includes("--dry-run");
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const { data: items, error } = await db
  .from("everything_items")
  .select("id, url, retries, processed_at")
  .eq("status", "error")
  .eq("source", "youtube")
  .like("error", "No transcript available%")
  .order("processed_at");
if (error) throw error;
for (const item of items!) console.log(`${item.processed_at?.slice(0, 16)} tries=${item.retries + 1} ${item.url}`);
console.log(`${items!.length} items${dryRun ? " would be requeued (dry run)" : ""}`);
if (!dryRun && items!.length > 0) {
  const { error: updateError } = await db
    .from("everything_items")
    .update({ status: "queued", retries: 0, error: null })
    .in("id", items!.map((item) => item.id));
  if (updateError) throw updateError;
  console.log("requeued");
}
