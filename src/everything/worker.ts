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
import { claimNextQueuedItem, markItemDone, markItemError, type EverythingItem } from "./db";
import { processFetchedContent } from "./pipeline/processContent";
import { fetchSubstackPost } from "./sources/substack";
import { ensureYtDlp, fetchYoutubeContent } from "./sources/youtube";
import type { FetchedContent } from "./types";

async function fetchContent(item: EverythingItem): Promise<FetchedContent> {
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
      await processFetchedContent(item, await fetchContent(item));
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
