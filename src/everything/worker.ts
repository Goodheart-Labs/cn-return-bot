/**
 * Worker for the everything pipeline. Run directly it drains the queue and
 * then exits; the paced Actions feed run takes one item at a time from it.
 *
 * It takes the next queued item and reads its content through the page
 * reader: a video's captions or an article's text. It then hands that content to
 * processFetchedContent. That step extracts the claims, drops the speculative
 * ones, fact-checks the ones the rater is not already confident about, and streams
 * every step into the everything_* tables. Items are processed one at a time.
 * An item that fails does not stop the rest of the queue.
 *
 * Usage:
 *   bun run src/everything/worker.ts
 */

import "dotenv/config";
import { readPage } from "../pipeline/fetch/readPage";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { imageMarker } from "../pipeline/utils/html";
import type { SubtitleCue } from "../pipeline/media/youtubeCaptions";
import { extractYoutubeVideoId } from "../everything-core/pageUrls";
import { claimNextQueuedItem, fetchItem, fetchItemClaims, fetchQueueOverview, fillProjectDisplayName, markItemDone, markItemError, QUEUE_PRIORITY, requeueItem, type EverythingItem, updateItemMeta } from "./db";
import { age, clip, duration, money, ordinal, table } from "./logFormat";
import { isWholePageChecked } from "../everything-core/wholePageChecked";
import { answerPassageRequest, openPassageRequests } from "./passageRequests";
import { checkRequestedPassage } from "./pipeline/checkRequestedPassage";
import { bodyText, processFetchedContent, resumeItemClaims } from "./pipeline/processContent";
import type { PageRead, ReadPage } from "../service/contract";
import { ensureYtDlp, UnreadableVideoError } from "./sources/youtube";
import { MAX_ITEM_RETRIES } from "./autoEnqueue";
import { describeTodaySpend, feedBudgetExhausted, requestBudgetExhausted, todaySpendUsd } from "./spendCap";
import type { FetchedContent } from "./types";

/** How many queued items the log lists before summarising the rest. */
const QUEUE_LINES = 8;

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

/** A shortform page holds one author's short posts as comments under it, with
 *  replies by other people, and has no text of its own. Until we read those
 *  comments (GOO-659), such an item is skipped: it ends as done with
 *  SHORTFORM_SKIP_REASON. The web page shows almost nothing either, so a read
 *  must not fall back to it (GOO-652). */
class ShortformPageError extends Error {
  constructor(url: string) {
    super(`${url} is a shortform page. Its short posts are comments, and the page has no text of its own`);
    this.name = "ShortformPageError";
  }
}

const SHORTFORM_SKIP_REASON = "shortform page";

/** The page reader's answer as the page, or the error that tells the worker
 *  how the item ends. */
function pageOrThrow(url: string, read: PageRead): ReadPage {
  switch (read.type) {
    case "page":
      return read.page;
    case "unreadable_video":
      throw new UnreadableVideoError(url, read.reason, read.captionsMayStillCome, read.why);
    case "shortform":
      throw new ShortformPageError(url);
    case "unreadable":
      throw new Error(`${url} could not be read: ${read.reason}`);
  }
}

/** The article's text as the pipeline reads it. Text from the fetch ladder or
 *  Jina is markdown and becomes plain text. Text from a site's API is plain
 *  text already. */
const articleText = (page: ReadPage) => (page.source.kind === "ladder" || page.source.kind === "jina" ? markdownToPlainText(page.text) : page.text);

/** What reading an item needs to know about it. */
type ItemToRead = Pick<EverythingItem, "url" | "title" | "published_at" | "full_text">;

function videoContent(item: ItemToRead, page: ReadPage, cues: SubtitleCue[], videoId: string): FetchedContent {
  const video = { url: item.url, videoId, title: page.title ?? item.title ?? "Untitled", publishedAt: page.publishedAt ?? undefined, cues, authorName: page.authorName ?? undefined };
  // A video enqueued with --doc carries its author's own clean transcript. The
  // claims come from that text, and only the timestamps from the video's cues.
  return item.full_text === null ? { kind: "youtube", ...video } : { kind: "youtube-transcript", ...video, text: item.full_text };
}

/** Reads an item's content. The title the item already has wins over the
 *  page's own, and the page's date over the stored one, which a reader's
 *  request may lack. */
export async function fetchContent(item: ItemToRead): Promise<FetchedContent> {
  // An item enqueued with --doc already carries its body, which was read from a
  // local file at enqueue time, and so does a requested page whose body the
  // extension captured. A video's cues are still read, so that its claims get
  // timestamps.
  if (item.full_text !== null && !extractYoutubeVideoId(item.url)) {
    return { kind: "substack", url: item.url, title: item.title ?? "Untitled", publishedAt: item.published_at ?? undefined, text: item.full_text };
  }
  const page = pageOrThrow(item.url, await readPage(item.url));
  if (page.source.kind === "youtube") return videoContent(item, page, page.source.cues, page.source.videoId);
  return {
    kind: "substack", // The plain article-text content kind, whatever the site.
    url: item.url,
    title: item.title ?? page.title ?? "Untitled",
    publishedAt: page.publishedAt ?? item.published_at ?? undefined,
    text: articleText(page),
    authorName: page.authorName ?? undefined,
  };
}

/** An item's text as a notewriter reads it. */
export interface ItemText {
  title: string;
  publishedAt: string | null;
  text: string;
  /** A video's caption cues, which give each passage its time in the video. */
  cues?: SubtitleCue[];
}

/** Reads an item's text the way processing does, without checking anything.
 *  The intake service stores it, so the notewriters can read the post. */
async function readItemText(item: EverythingItem): Promise<ItemText> {
  const content = await fetchContent(item);
  const cues = "cues" in content ? content.cues : undefined;
  return { title: content.title, publishedAt: content.publishedAt?.slice(0, 10) ?? null, text: bodyText(content), ...(cues && { cues }) };
}

/** Reads an item's text and, unless `keepText`, stores it. */
export async function fetchAndStoreItemText(itemId: string, options: { keepText: boolean }): Promise<ItemText> {
  const item = await fetchItem(itemId);
  const read = await readItemText(item);
  if (!options.keepText) await updateItemMeta(item.id, { title: read.title, published_at: read.publishedAt, full_text: read.text });
  return read;
}

/** Names the tier an item is waiting at, for the queue listing. */
function tierName(priority: number): string {
  if (priority >= QUEUE_PRIORITY.requested) return "requested";
  if (priority === QUEUE_PRIORITY.prioritized) return "priority";
  return "visits";
}

/** Prints what is waiting, in the order the queue hands it out. The worker
 *  itself only ever holds one item at a time, so without this read a run
 *  never says how much work is queued or why one item goes before another. */
export async function logQueue(): Promise<void> {
  const queue = await fetchQueueOverview();
  if (queue.length === 0) {
    console.log("\nQUEUE · empty right now");
    return;
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
}

/** Where one item ended. "no_captions_yet" is an error that gets its repeat
 *  attempts like any other, but it is expected, so it does not fail the feed
 *  run. */
export type ItemOutcome = "done" | "capped" | "error" | "no_captions_yet";

/** Marks an item done that could not be read at all. Its passage requests
 *  get their answer, no note, because nothing could be checked. */
async function finishUnreadItem(itemId: string, skipReason: string) {
  for (const request of await openPassageRequests(itemId)) await answerPassageRequest(request.id, false);
  await markItemDone(itemId, skipReason);
}

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
  await finishUnreadItem(item.id, err.reason);
  return "done";
}

/** Records on the item's row why it failed. Both the pipeline's workers and
 *  the Claude note writer's runner use this, so a failure looks the same
 *  whichever of them hit it. A video without captions and a shortform page
 *  are not failures: they end as done without a check. */
export async function recordItemFailure(item: EverythingItem, err: Error): Promise<ItemOutcome> {
  if (err instanceof UnreadableVideoError) return recordUnreadableVideo(item, err);
  if (err instanceof ShortformPageError) {
    console.log(`  ${err.message} · finished without checking`);
    await finishUnreadItem(item.id, SHORTFORM_SKIP_REASON);
    return "done";
  }
  await markItemError(item.id, err.message ?? "unknown");
  return "error";
}

/** Checks the whole page. Claims left pending or in error mean an earlier run
 *  was killed while checking them. We resume exactly those instead of
 *  fetching the content and extracting all over again. An item whose claims
 *  are all finished still goes through extraction. That is what makes a
 *  promoted item work: a page that only carried a reader's note, or a checked
 *  paragraph, is read in full now, and the duplicate guard inside
 *  processFetchedContent keeps the finished claims from being extracted a
 *  second time. */
async function checkPage(item: EverythingItem) {
  const claims = await fetchItemClaims(item.id);
  if (claims.some((c) => c.status === "pending" || c.status === "error")) return resumeItemClaims(item);
  const content = await fetchContent(item);
  // The fetch is also where the source's display name comes from, so a
  // project created knowing only its slug gets its real name here.
  await fillProjectDisplayName(item.project_id, content.authorName);
  return processFetchedContent(item, content, claims);
}

/** Runs one claimed item through fetch, extraction and checking, and records
 *  where it ended: done, put back because a budget ran out part way, or
 *  errored. Both workers use this: the Actions feed run for the backlog tiers,
 *  and the intake service for reader-requested items. */
export async function processQueuedItem(item: EverythingItem): Promise<ItemOutcome> {
  const startedAt = Date.now();
  const spentBefore = await todaySpendUsd();
  try {
    // A page that was checked in full is not read again. Only the passages
    // readers asked about are checked, each on its own. A paragraph item is
    // nothing but the passage, so it is checked the same way.
    const passages = await openPassageRequests(item.id);
    const pageWanted = !passages.length || (item.checked_scope === "page" && !isWholePageChecked(item));
    const tally = pageWanted ? await checkPage(item) : null;
    // An item cut short by its budget goes back in the queue rather than
    // being marked done. Its unchecked claims are still pending, so the next
    // run resumes exactly those.
    if (tally && tally.capped > 0) {
      await requeueItem(item.id);
      console.log(`  budget reached part way through, put back in the queue with ${tally.capped} claims left`);
      return "capped";
    }
    if (passages.length && (await requestBudgetExhausted())) {
      await requeueItem(item.id);
      console.log("  the reader budget is spent, put back in the queue before checking the passages readers asked about");
      return "capped";
    }
    for (const request of passages) await answerPassageRequest(request.id, await checkRequestedPassage(item, request));
    await markItemDone(item.id, tally?.skipReason ?? null);
    // The per-item cost is already recorded per claim; this is the first time
    // it is shown. It is what tells you which items are expensive.
    const cost = (await todaySpendUsd()) - spentBefore;
    const checked = tally ? tally.notes + tally.no_note + tally.errors : 0;
    console.log(
      `  finished in ${duration(Date.now() - startedAt)} · cost ${money(cost)} · wrote ${tally?.notes ?? 0} note${tally?.notes === 1 ? "" : "s"} from ${checked} claim${checked === 1 ? "" : "s"} checked · ${passages.length} passage${passages.length === 1 ? "" : "s"} readers asked about`,
    );
    return "done";
  } catch (err: any) {
    if (!(err instanceof UnreadableVideoError || err instanceof ShortformPageError)) console.error(`  failed after ${duration(Date.now() - startedAt)}: ${err?.message}`);
    return recordItemFailure(item, err);
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
