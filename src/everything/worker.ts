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
import { fetchWebPage } from "../pipeline/tool-calling/tools";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { claimNextQueuedItem, fetchItemClaims, markItemDone, markItemError, requeueItem, type EverythingItem } from "./db";
import { processFetchedContent, resumeItemClaims } from "./pipeline/processContent";
import { fetchSubstackPost, imageMarker } from "./sources/substack";
import { ensureYtDlp, fetchYoutubeContent, fetchYoutubeTranscriptContent } from "./sources/youtube";
import { describeSpend, spendCapReached, todaySpendUsd } from "./spendCap";
import type { FetchedContent } from "./types";

/** The everything path ingests whole articles, so its fetch cap matches the
 *  page_text column limit rather than a verifier's context window. */
const WEB_FETCH_MAX_CHARS = 500_000;

/** The archive and browser steps of the fetch ladder prepend this note to the
 *  content. It must not end up in the article text a claim could quote. */
const FETCHED_VIA_PREFIX = /^\[fetched via [^\]]+\]\n\n/;

/** An image whose CDN URL asks for a rendered size this small is interface
 *  furniture, an avatar or an icon, not article content worth describing. */
const MIN_CONTENT_IMAGE_SIZE_RE = /[wh]_(\d{1,2})\b/;

const contentImageMarker = (src: string) => (MIN_CONTENT_IMAGE_SIZE_RE.test(src) ? "" : `\n\n${imageMarker(src)}\n\n`);

/** Turns the fetch ladder's markdown into the plain text the rest of the
 *  pipeline expects. Link and image syntax must not survive: a claim's
 *  verbatim quote is later matched against the live page's own text, and
 *  `[text](url)` injects words that are not on the page. An image becomes the
 *  pipeline's inline image marker, so it still gets described and attached to
 *  claims the way Substack images are. Images wrapped in a link go first,
 *  because the marker they leave behind contains brackets the plain link rule
 *  cannot see past. */
function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\[\s*!\[[^\]]*\]\(([^)\s]+)[^)]*\)\s*\]\([^)]*\)/g, (_match, src) => contentImageMarker(src))
    .replace(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g, (_match, src) => contentImageMarker(src))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Fetches an arbitrary web page through the X pipeline's fetch ladder: three
 *  user agents, then the archives, then a headless browser render. The title
 *  the request captured wins over the page's own; the markdown's first
 *  heading, which is Readability's page title, is the fallback and is dropped
 *  from the body either way. The stored published date is preserved, because a
 *  web fetch has none and processing would otherwise wipe it. */
async function fetchWebContent(item: EverythingItem): Promise<FetchedContent> {
  const result = await fetchWebPage(item.url, { maxChars: WEB_FETCH_MAX_CHARS });
  if (!result.ok) throw new Error(result.content);
  const markdown = result.content.replace(FETCHED_VIA_PREFIX, "");
  const heading = markdown.match(/^# (.+)\n+/);
  return {
    kind: "substack", // The plain article-text content kind, whatever the site.
    url: item.url,
    title: item.title ?? heading?.[1]?.trim() ?? "Untitled",
    publishedAt: item.published_at ?? undefined,
    text: markdownToPlainText(heading ? markdown.slice(heading[0].length) : markdown),
  };
}

async function fetchContent(item: EverythingItem): Promise<FetchedContent> {
  // An item enqueued with --doc already carries its body, which was read from a
  // local file at enqueue time, and so does a requested page whose body the
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
      try {
        return await fetchSubstackPost(item.url);
      } catch (err: any) {
        // Substack's API 403s datacenter IPs, so this always fails in CI. The
        // web-fetch ladder still has a route to the post: the archives, and a
        // headless browser render as the last step.
        console.log(`  Substack fetch failed (${err?.message}) — trying the web-fetch ladder`);
        return fetchWebContent(item);
      }
    default:
      return fetchWebContent(item);
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
      // Claims left pending or in error mean an earlier run was killed while
      // checking them. We resume exactly those instead of fetching the content
      // and extracting all over again. An item whose claims are all finished
      // still goes through extraction. That is what makes a promoted item
      // work: a page that only carried a reader's note, or a checked
      // paragraph, is read in full now, and the duplicate guard inside
      // processFetchedContent keeps the finished claims from being extracted
      // a second time.
      const claims = await fetchItemClaims(item.id);
      const tally = claims.some((c) => c.status === "pending" || c.status === "error")
        ? await resumeItemClaims(item)
        : await processFetchedContent(item, await fetchContent(item), claims);
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
