/**
 * Worker for the everything pipeline. Run directly it drains the queue and
 * then exits; the paced Actions feed run takes one item at a time from it.
 *
 * It takes the next queued item and fetches its content, which is either a
 * YouTube transcript or a Substack article. It then hands that content to
 * processFetchedContent. That step extracts the claims, drops the speculative
 * ones, fact-checks the ones the rater is not already confident about, and streams
 * every step into the everything_* tables. Items are processed one at a time.
 * An item that fails does not stop the rest of the queue.
 *
 * Usage:
 *   bun run src/everything/worker.ts
 */

import "dotenv/config";
import { fetchWebPage } from "../pipeline/tool-calling/tools";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { claimNextQueuedItem, fetchItem, fetchItemClaims, fetchQueueOverview, fillProjectDisplayName, markItemDone, markItemError, QUEUE_PRIORITY, requeueItem, type EverythingItem, type QueuedItemSummary, updateItemMeta } from "./db";
import { age, clip, duration, money, ordinal, table } from "./logFormat";
import { bodyText, processFetchedContent, resumeItemClaims, workPriorityOf } from "./pipeline/processContent";
import { requestItemText } from "../service/client";
import type { ItemTextResponse } from "../service/contract";
import { fetchForumPost } from "./sources/lesswrong";
import { fetchSubstackPost, imageMarker } from "./sources/substack";
import { ensureYtDlp, fetchYoutubeContent, fetchYoutubeTranscriptContent, UnreadableVideoError } from "./sources/youtube";
import { MAX_ITEM_RETRIES } from "./autoEnqueue";
import { describeTodaySpend, feedBudgetExhausted, todaySpendUsd } from "./spendCap";
import type { FetchedContent } from "./types";

/** How many queued items the log lists before summarising the rest. */
const QUEUE_LINES = 8;

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
  const result = await fetchWebPage(item.url);
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
    case "lesswrong":
      try {
        return await fetchForumPost(item.url);
      } catch (err: any) {
        // If the forum's GraphQL API refuses our runner, the web-fetch ladder
        // still has a route to the post through its headless browser render.
        console.log(`  Forum fetch failed (${err?.message}) — trying the web-fetch ladder`);
        return fetchWebContent(item);
      }
    default:
      return fetchWebContent(item);
  }
}

/** Reads an item's text the way processing does, without checking anything.
 *  The Claude note writer (GOO-507) needs it before its agents read a post. */
export async function readItemText(item: EverythingItem): Promise<ItemTextResponse> {
  const content = await fetchContent(item);
  const cues = "cues" in content ? content.cues : undefined;
  return { title: content.title, publishedAt: content.publishedAt?.slice(0, 10) ?? null, text: bodyText(content), ...(cues && { cues }) };
}

/** Reads an item's text and, unless `keepText`, stores it. A video's captions
 *  need the services machine's proxy, so videos are read there, and every
 *  other page is read here. A video is read without its stored text, so the
 *  answer always carries its cues. */
export async function fetchAndStoreItemText(itemId: string, options: { keepText: boolean }): Promise<ItemTextResponse> {
  const item = await fetchItem(itemId);
  const read = item.source === "youtube" ? await requestItemText({ priority: workPriorityOf(item), item: { ...item, full_text: null } }) : await readItemText(item);
  if (!options.keepText) await updateItemMeta(item.id, { title: read.title, published_at: read.publishedAt, full_text: read.text });
  return read;
}

/** Names the tier an item is waiting at, for the queue listing. */
function tierName(priority: number): string {
  if (priority >= QUEUE_PRIORITY.requested) return "requested";
  if (priority === QUEUE_PRIORITY.prioritized) return "priority";
  return "visits";
}

/** Prints what is waiting, in the order this worker will take it, and returns
 *  it. The worker itself only ever holds one item at a time, so without this
 *  read a run never says how much work is queued or why one item goes before
 *  another. The feed run also reads the rows to decide whether to walk for
 *  new posts. */
export async function logQueue(): Promise<QueuedItemSummary[]> {
  const queue = await fetchQueueOverview();
  if (queue.length === 0) {
    console.log("\nQUEUE · empty right now");
    return queue;
  }
  const oldest = queue.reduce((a, b) => (a.created_at < b.created_at ? a : b));
  console.log(`\nQUEUE · ${queue.length} waiting right now, in the order the worker takes them · oldest waiting ${age(oldest.created_at)}`);
  const rows = queue
    .slice(0, QUEUE_LINES)
    .map((item, i) => [
      ordinal(i + 1),
      tierName(item.priority),
      `[${item.source}]`,
      clip(item.title ?? item.url, 48),
      `waiting ${age(item.created_at)}`,
    ]);
  for (const line of table(["", "tier", "source", "title", ""], rows, ["right"])) console.log(line);
  if (queue.length > QUEUE_LINES) console.log(`     … and ${queue.length - QUEUE_LINES} more`);
  return queue;
}

/** Whether a feed item is waiting: the post the last walk picked, or an item a
 *  killed run left half done. The feed run walks only when this is false, so
 *  whatever waits is finished before the walk picks the next post. */
export const feedItemsQueued = (queue: QueuedItemSummary[]): boolean =>
  queue.some((item) => item.status === "queued" && item.priority < QUEUE_PRIORITY.requested);

/** Where one item ended. "no_captions_yet" is an error that gets its repeat
 *  attempts like any other, but it is expected, so it does not fail the feed
 *  run. */
type ItemOutcome = "done" | "capped" | "error" | "no_captions_yet";

/** A video we cannot read is not a failure (GOO-422). A young video without
 *  captions stays in error so the walk tries it again later, because YouTube
 *  may not have made its automatic captions yet. On its last allowed attempt,
 *  and for every other unreadable video, the item ends as done with the
 *  reason as its skip reason. We do not put the young video back in the queue
 *  ourselves, because the feed worker would take it again at once. */
async function recordUnreadableVideo(item: EverythingItem, err: UnreadableVideoError): Promise<ItemOutcome> {
  if (err.captionsMayStillCome && item.retries < MAX_ITEM_RETRIES) {
    console.log(`  ${err.message} · tried again after its rest time`);
    await markItemError(item.id, err.message);
    return "no_captions_yet";
  }
  console.log(`  ${err.message} · finished without checking`);
  await markItemDone(item.id, err.reason);
  return "done";
}

/** Runs one claimed item through fetch, extraction and checking, and records
 *  where it ended: done, put back because a budget ran out part way, or
 *  errored. Both workers use this: the Actions feed run for the backlog tiers,
 *  and the intake service for reader-requested items. */
export async function processQueuedItem(item: EverythingItem): Promise<ItemOutcome> {
  const startedAt = Date.now();
  const spentBefore = await todaySpendUsd();
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
    let tally;
    if (claims.some((c) => c.status === "pending" || c.status === "error")) {
      tally = await resumeItemClaims(item);
    } else {
      const content = await fetchContent(item);
      // The fetch is also where the source's display name comes from, so a
      // project created knowing only its slug gets its real name here.
      await fillProjectDisplayName(item.project_id, content.authorName);
      tally = await processFetchedContent(item, content, claims);
    }
    // An item cut short by its budget goes back in the queue rather than
    // being marked done. Its unchecked claims are still pending, so the next
    // run resumes exactly those.
    if (tally.capped > 0) {
      await requeueItem(item.id);
      console.log(`  budget reached part way through, put back in the queue with ${tally.capped} claims left`);
      return "capped";
    }
    await markItemDone(item.id, tally.skipReason);
    // The per-item cost is already recorded per claim; this is the first time
    // it is shown. It is what tells you which items are expensive.
    const cost = (await todaySpendUsd()) - spentBefore;
    const checked = tally.notes + tally.no_note + tally.errors;
    console.log(
      `  finished in ${duration(Date.now() - startedAt)} · cost ${money(cost)} · wrote ${tally.notes} note${tally.notes === 1 ? "" : "s"} from ${checked} claim${checked === 1 ? "" : "s"} checked`,
    );
    return "done";
  } catch (err: any) {
    if (err instanceof UnreadableVideoError) return recordUnreadableVideo(item, err);
    console.error(`  failed after ${duration(Date.now() - startedAt)}: ${err?.message}`);
    await markItemError(item.id, err?.message ?? "unknown");
    return "error";
  }
}

/** Takes the next feed-tier item and processes it. "empty" means nothing was
 *  waiting. The Actions feed run calls this once per run;
 *  reader-requested items are never taken here, the intake service on the
 *  machine owns that tier. */
export async function processNextFeedItem(): Promise<ItemOutcome | "empty"> {
  const item = await claimNextQueuedItem("feed");
  if (!item) return "empty";
  console.log(`\nCHECKING NOW · [${item.source}] ${clip(item.title ?? item.url, 60)}`);
  return processQueuedItem(item);
}

/** Processes the backlog tiers until they are empty or the feed budget is
 *  spent, with no pacing. This is the local `everything-worker` command, an
 *  escape hatch that must never run while the paced dispatch is active.
 *  Returns how many items it finished. */
export async function drainQueue(): Promise<number> {
  let processed = 0;
  await logQueue();
  while (true) {
    if (await feedBudgetExhausted()) {
      console.log(`\nFeed budget reached (${await describeTodaySpend()}) — stopping for today`);
      break;
    }
    const ended = await processNextFeedItem();
    if (ended === "empty" || ended === "capped") break;
    processed++;
  }
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
