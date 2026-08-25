/**
 * Turns reader requests into pipeline work. The everything-priority-feeds
 * workflow runs this at the start of every cycle, before anything is enqueued
 * from the feeds. Both consumers are cheap and run even on a day whose spend
 * cap is already reached. The one exception to "no LLM here" is the small
 * Flash call that trims a captured page text down to its article.
 *
 * Note requests ("check this page") become queue items at the requested
 * priority tier, so the worker takes them before any feed backlog. A request
 * for a page we already ingested resolves against that item instead: a queued
 * item is bumped to the requested tier, a finished item marks the request done,
 * and an errored item is put back in the queue.
 *
 * Follow requests ("keep this blog or channel checked") are validated by
 * listing the feed once, and then promoted into everything_followed_feeds. The
 * auto-enqueue walks that table ahead of the curated priority feeds.
 *
 * A request that cannot be consumed is marked on its own row: a follow request
 * for something that is not a followable feed is "skipped" with the reason,
 * and anything that throws is "error" with the message. Nothing is retried
 * silently; a human can set a row back to "pending" after fixing the cause.
 *
 * Usage:
 *   bun run src/everything/consumeRequests.ts
 */

import "dotenv/config";
import { extractYoutubeVideoId } from "../everything-shared/pageUrls";
import { WEB_PROJECT_SLUG } from "../everything-shared/projects";
import { cleanCapturedPageText } from "./pipeline/cleanCapturedText";
import {
  fetchPendingFollowRequests,
  fetchPendingNoteRequests,
  fetchFollowedFeeds,
  findItemForPageUrl,
  insertFollowedFeed,
  insertQueuedItem,
  promoteItemToWholePage,
  QUEUE_PRIORITY,
  raiseItemPriority,
  requeueItem,
  resolveFollowRequest,
  resolveNoteRequest,
  resolveProjectId,
  type FollowRequestRow,
  type NoteRequestRow,
} from "./db";
import { fetchFeedPosts } from "./sources/substack";
import { fetchChannelVideos } from "./sources/youtube";
import type { ItemSource } from "./types";

/** A requested YouTube video is its own source kind, because the worker
 *  fetches its transcript and cues for timestamped claims. Every other page is
 *  a plain `web` item that the worker fetches through the X pipeline's
 *  web-fetch ladder, Substack posts included — no special-casing. */
function classifyRequestSource(pageUrl: string): ItemSource {
  return extractYoutubeVideoId(pageUrl) ? "youtube" : "web";
}

/** Consumes one note request. Returns a log line describing what happened.
 *  Exported for the tests, which mock the db module underneath it. */
export async function consumeNoteRequest(request: NoteRequestRow): Promise<string> {
  const existing = await findItemForPageUrl(request.page_url);
  if (existing) {
    // Only a finished whole-page check refuses the request. An item that
    // exists because a reader wrote a note on the page, or because one
    // paragraph was checked, is promoted to a whole-page check instead.
    if (existing.status === "done" && existing.checked_scope === "page") {
      await resolveNoteRequest(request.id, "done", "page was already checked", existing.id);
      return `already checked: ${request.page_url}`;
    }
    // A worker is holding this item right now. Taking the row away mid-run
    // would race it, so the request stays pending and the next cycle retries.
    if (existing.status === "processing") {
      return `item is being processed, request stays pending: ${request.page_url}`;
    }
    if (existing.checked_scope !== "page") {
      // The promotion overwrites full_text. A paragraph item's old text would
      // make the worker re-check the same paragraph and then record it as a
      // whole-page check. The fresh capture is used when the request carries
      // one; without it the worker fetches the page itself.
      const source = classifyRequestSource(request.page_url);
      let fullText = source === "youtube" ? null : (request.page_text ?? null);
      if (fullText) fullText = await cleanCapturedPageText(fullText);
      await promoteItemToWholePage(existing.id, fullText, QUEUE_PRIORITY.requested);
      // A paragraph request on an existing item cannot be honoured as a
      // paragraph check, because one item holds one body text. The whole page
      // contains the paragraph, so it is checked instead, and the request row
      // says so.
      const reason = request.selection ? "checked the whole page instead" : null;
      await resolveNoteRequest(request.id, "enqueued", reason, existing.id);
      return `promoted existing item to a whole-page check: ${request.page_url}`;
    }
    // A whole-page item that is queued or errored goes back in the queue at
    // the requested tier. Its full_text stays as it is. A Substack item's RSS
    // body must survive, because CI cannot fetch Substack pages itself.
    if (existing.status === "error") await requeueItem(existing.id);
    await raiseItemPriority(existing.id, QUEUE_PRIORITY.requested);
    await resolveNoteRequest(request.id, "enqueued", null, existing.id);
    return `bumped existing item to requested priority: ${request.page_url}`;
  }

  const source = classifyRequestSource(request.page_url);
  // A request on a highlighted paragraph checks exactly that paragraph, never
  // the whole page: the selection becomes the item's text. A whole-page
  // request uses the page text the extension captured, run through the
  // article-only cleanup, because the raw capture drags in comments and
  // sidebars. Without either, the worker fetches the page itself — through
  // the web-fetch ladder for a text page, or as transcript and cues for a
  // YouTube video.
  let fullText = request.selection ?? (source === "youtube" ? undefined : request.page_text ?? undefined);
  if (fullText && fullText === request.page_text) fullText = await cleanCapturedPageText(fullText);

  const itemId = await insertQueuedItem({
    project_id: await resolveProjectId(WEB_PROJECT_SLUG),
    source,
    url: request.page_url,
    title: request.page_title || undefined,
    full_text: fullText,
    priority: QUEUE_PRIORITY.requested,
    checked_scope: request.selection ? "paragraph" : "page",
  });
  await resolveNoteRequest(request.id, "enqueued", null, itemId);
  return `enqueued [${source}]: ${request.page_url}`;
}

export async function consumeNoteRequests(): Promise<void> {
  for (const request of await fetchPendingNoteRequests()) {
    try {
      console.log(`[note request] ${await consumeNoteRequest(request)}`);
    } catch (err: any) {
      // A broken request must not block the rest of the inbox. The failure is
      // recorded on the request row, where a human sees it and can set the row
      // back to pending after fixing the cause.
      await resolveNoteRequest(request.id, "error", err?.message ?? "unknown", null);
      console.error(`[note request] error for ${request.page_url}: ${err?.message}`);
    }
  }
}

/** Normalizes a follow request into the feed we would store, or explains why it
 *  cannot be followed. A Substack feed must be in its *.substack.com form,
 *  because that is the only shape the RSS relay accepts in CI. */
function normalizeFollowFeed(
  request: FollowRequestRow,
): { project_slug: string; feed_type: "substack" | "youtube"; feed_url: string } | { invalid: string } {
  if (request.feed_type === "substack") {
    const m = request.feed_url.match(/^https:\/\/([\w-]+)\.substack\.com\/?$/);
    if (!m) return { invalid: "not a *.substack.com publication URL" };
    return { project_slug: m[1]!.toLowerCase(), feed_type: "substack", feed_url: `https://${m[1]!.toLowerCase()}.substack.com` };
  }
  const m = request.feed_url.match(/^https:\/\/(?:www\.)?youtube\.com\/(@[\w.-]+|channel\/[\w-]+)\/?$/);
  if (!m) return { invalid: "not a YouTube channel URL" };
  const path = m[1]!;
  return {
    project_slug: path.replace(/^@|^channel\//, "").toLowerCase(),
    feed_type: "youtube",
    feed_url: `https://www.youtube.com/${path}`,
  };
}

export async function consumeFollowRequests(): Promise<void> {
  const requests = await fetchPendingFollowRequests();
  if (requests.length === 0) return;

  // The followed list holds every feed we poll, the curated ones included, so
  // this one lookup covers "already followed" completely.
  const known = new Set((await fetchFollowedFeeds()).map((f) => f.feed_url.replace(/\/$/, "").toLowerCase()));

  for (const request of requests) {
    try {
      const feed = normalizeFollowFeed(request);
      if ("invalid" in feed) {
        await resolveFollowRequest(request.id, "skipped", feed.invalid);
        console.log(`[follow request] skipped (${feed.invalid}): ${request.feed_url}`);
        continue;
      }
      if (known.has(feed.feed_url.toLowerCase())) {
        await resolveFollowRequest(request.id, "accepted", "already followed");
        console.log(`[follow request] already followed: ${feed.feed_url}`);
        continue;
      }
      // Listing the feed once proves it exists and is reachable from where the
      // pipeline runs, before we commit to polling it forever.
      if (feed.feed_type === "substack") await fetchFeedPosts(feed.feed_url);
      else fetchChannelVideos(feed.feed_url, 1);
      await insertFollowedFeed(feed);
      known.add(feed.feed_url.toLowerCase());
      await resolveFollowRequest(request.id, "accepted", null);
      console.log(`[follow request] now following [${feed.feed_type}] ${feed.feed_url}`);
    } catch (err: any) {
      await resolveFollowRequest(request.id, "error", err?.message ?? "unknown");
      console.error(`[follow request] error for ${request.feed_url}: ${err?.message}`);
    }
  }
}

export async function consumeRequests(): Promise<void> {
  await consumeNoteRequests();
  await consumeFollowRequests();
}

if (import.meta.main) {
  consumeRequests().catch((err) => {
    console.error("[consumeRequests] Fatal error:", err);
    process.exit(1);
  });
}
