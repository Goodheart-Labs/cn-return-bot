// Gives every Claude video note without a start time its place in the video
// (GOO-507). The old VPS copy of the note writer posted notes on videos with
// code that did not yet set the claim's times, so the extension could not put
// them on the scrub bar. The script reads each video's caption cues through the
// extraction service and sets the times the way posting sets them now.
// Run: bun run src/scripts_jim/2026_10_22_video_note_timing/backfill.ts
import { createClient } from "@supabase/supabase-js";
import { config as loadDotenv } from "dotenv";
import { ENV_DIR } from "../../cnEnv";
import type { Database } from "../../everything-core/database.types";
import { extractYoutubeVideoId } from "../../everything-core/pageUrls";
import { buildVideoLink, contextTimeSpan } from "../../everything/pipeline/extractClaims";
import { requestItemText } from "../../service/client";

loadDotenv({ path: `${ENV_DIR}/.env`, quiet: true });
const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const { data: claims, error } = await db
  .from("everything_claims")
  .select("id, item_id, context_quote, item:everything_items!inner(*)")
  .eq("judgement", "claude_code")
  .is("start_seconds", null)
  .like("everything_items.url", "%youtube.com%");
if (error) throw new Error(JSON.stringify(error));

for (const [itemId, itemClaims] of Map.groupBy(claims, (c) => c.item_id)) {
  const item = itemClaims[0]!.item;
  const videoId = extractYoutubeVideoId(item.url)!;
  const { cues } = await requestItemText({ priority: "reader", item });
  for (const claim of itemClaims) {
    const { start, end } = contextTimeSpan(claim.context_quote ?? "", cues);
    if (start === undefined) {
      console.log(`${itemId} ${claim.id}: passage not found in the captions`);
      continue;
    }
    const { error: updateError } = await db
      .from("everything_claims")
      .update({ start_seconds: Math.floor(start), end_seconds: end === undefined ? null : Math.ceil(end), context_url: buildVideoLink(videoId, start) })
      .eq("id", claim.id);
    if (updateError) throw new Error(JSON.stringify(updateError));
    console.log(`${item.title}: ${Math.floor(start)}s`);
  }
}
