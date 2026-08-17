/**
 * Worker for the everything pipeline. It drains the queue and then exits.
 *
 * It takes the oldest queued item and fetches its content, which is either a
 * YouTube transcript or a Substack article. It then hands that content to
 * processFetchedContent. That step extracts the claims, drops the speculative
 * ones, fact-checks the ones Opus is not already confident about, and streams
 * every step into the everything_* tables. Items are processed one at a time.
 * An item that fails does not stop the rest of the queue.
 *
 * Usage:
 *   bun run src/everything/worker.ts
 */

import "dotenv/config";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { claimNextQueuedItem, fetchItemClaims, markItemDone, markItemError, requeueItem, type EverythingItem } from "./db";
import { processFetchedContent, resumeItemClaims } from "./pipeline/processContent";
import { fetchSubstackPost } from "./sources/substack";
import { ensureYtDlp, fetchYoutubeContent, fetchYoutubeTranscriptContent } from "./sources/youtube";
import { describeSpend, spendCapReached, todaySpendUsd } from "./spendCap";
import type { FetchedContent } from "./types";

async function fetchContent(item: EverythingItem): Promise<FetchedContent> {
  // An item enqueued with --doc already carries its body, which was read from a
  // local file at enqueue time, and so does a requested web page, whose body the
  // extension captured. A YouTube doc still needs the video's cues fetched, so
  // that its claims get timestamps.
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
    default:
      throw new Error(`Cannot fetch a '${item.source}' item without stored text: ${item.url}`);
  }
}

/** Processes queued items until the queue is empty or the daily spend cap is
 *  reached. Returns how many items it finished. */
export async function drainQueue(): Promise<number> {
  let processed = 0;
  while (true) {
    if (await spendCapReached()) {
      console.log(`\nDaily spend cap reached (${describeSpend(await todaySpendUsd())}) — stopping for today`);
      break;
    }
    const item = await claimNextQueuedItem();
    if (!item) break;
    console.log(`\n=== [${item.source}] ${item.url}`);
    try {
      // If the item already has claims, an earlier run was killed after it had
      // extracted them. We resume its unfinished claims instead of fetching the
      // content and extracting all over again.
      const tally =
        (await fetchItemClaims(item.id)).length > 0
          ? await resumeItemClaims(item)
          : await processFetchedContent(item, await fetchContent(item));
      // An item cut short by the spend cap goes back in the queue rather than
      // being marked done. Its unchecked claims are still pending, so the next
      // day's run resumes exactly those.
      if (tally.capped > 0) {
        await requeueItem(item.id);
        console.log(`  Spend cap reached mid-item — requeued with ${tally.capped} claims left`);
        break;
      }
      await markItemDone(item.id);
    } catch (err: any) {
      console.error(`  Item failed: ${err?.message}`);
      await markItemError(item.id, err?.message ?? "unknown");
    }
    processed++;
  }
  console.log(processed ? `\nDone — processed ${processed} item(s)` : "Queue empty — nothing to do");
  return processed;
}

if (import.meta.main) {
  ensureYtDlp();
  drainQueue()
    .then(() => closeBrowser())
    .catch((err) => {
      console.error("[worker] Fatal error:", err);
      process.exit(1);
    });
}
