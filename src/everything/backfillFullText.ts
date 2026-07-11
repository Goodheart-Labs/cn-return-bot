/**
 * Backfill everything_items.full_text — the complete source text the
 * write-note flow searches. Articles/pages only; YouTube items are skipped
 * (no local transcript source) and stay null, which the UI treats as
 * "transcript unavailable".
 *
 *   bun run src/everything/backfillFullText.ts
 */

import "dotenv/config";
import { getSupabaseClient } from "../api/supabaseClient";
import { htmlToText } from "./sources/substack";

async function main() {
  const sb = getSupabaseClient();
  const { data: items, error } = await sb
    .from("everything_items")
    .select("id, url, title")
    .is("full_text", null);
  if (error) throw error;

  let filled = 0;
  for (const item of items ?? []) {
    if (/youtube\.com|youtu\.be/.test(item.url)) continue;
    try {
      const text = htmlToText(await (await fetch(item.url)).text());
      if (!text) continue;
      const { error: updateError } = await sb
        .from("everything_items")
        .update({ full_text: text })
        .eq("id", item.id);
      if (updateError) throw updateError;
      filled++;
      console.log(`✓ ${item.title} (${text.length} chars)`);
    } catch (e) {
      console.warn(`fetch failed: ${item.title}: ${e}`);
    }
  }
  console.log(`Backfilled ${filled}/${items?.length ?? 0} items.`);
}

await main();
