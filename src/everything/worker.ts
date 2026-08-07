/**
 * Everything-pipeline worker: drain the queue and exit.
 *
 * Takes the oldest queued item, fetches its content (YouTube transcript or
 * Substack article), then hands it to processFetchedContent — extract claims,
 * drop speculation, fact-check the non-confident ones, and stream every step
 * into the everything_* tables. One item at a time; item failures don't stop
 * the queue.
 *
 * Usage:
 *   bun run src/everything/worker.ts
 */

import "dotenv/config";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { claimNextQueuedItem, fetchItemClaims, markItemDone, markItemError, type EverythingItem } from "./db";
import { processFetchedContent, resumeItemClaims } from "./pipeline/processContent";
import { fetchSubstackPost } from "./sources/substack";
import { ensureYtDlp, fetchYoutubeContent, fetchYoutubeTranscriptContent } from "./sources/youtube";
import type { FetchedContent } from "./types";

async function fetchContent(item: EverythingItem): Promise<FetchedContent> {
  // A local `--doc` item already carries its body (read from a file at enqueue).
  // A YouTube doc still fetches the video's cues so its claims get timestamps.
  if (item.full_text !== null) {
    return item.source === "youtube"
      ? fetchYoutubeTranscriptContent(item.url, item.full_text)
      : {
          kind: "substack",
          url: item.url,
          title: item.title ?? "Untitled",
          publishedAt: item.published_at ?? undefined,
          text: item.full_text,
        };
  }
  switch (item.source) {
    case "youtube":
      return fetchYoutubeContent(item.url);
    case "substack":
      return fetchSubstackPost(item.url);
  }
}

async function main() {
  ensureYtDlp();
  let processed = 0;
  while (true) {
    const item = await claimNextQueuedItem();
    if (!item) break;
    console.log(`\n=== [${item.source}] ${item.url}`);
    try {
      // Existing claims mean a killed run already extracted this item — resume
      // its unfinished claims instead of refetching and re-extracting.
      if ((await fetchItemClaims(item.id)).length > 0) await resumeItemClaims(item);
      else await processFetchedContent(item, await fetchContent(item));
      await markItemDone(item.id);
    } catch (err: any) {
      console.error(`  Item failed: ${err?.message}`);
      await markItemError(item.id, err?.message ?? "unknown");
    }
    processed++;
  }
  console.log(processed ? `\nDone — processed ${processed} item(s)` : "Queue empty — nothing to do");
  try {
    await closeBrowser();
  } catch {}
}

main().catch((err) => {
  console.error("[worker] Fatal error:", err);
  process.exit(1);
});
