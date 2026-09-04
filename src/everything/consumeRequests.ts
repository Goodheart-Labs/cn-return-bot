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
 * A request that cannot be consumed is marked on its own row with the reason.
 * Nothing is retried silently; a human can set a row back to "pending" after
 * fixing the cause.
 *
 * Usage:
 *   bun run src/everything/consumeRequests.ts
 */

import "dotenv/config";
import { extractYoutubeVideoId } from "../everything-shared/pageUrls";
import { WEB_PROJECT_SLUG } from "../everything-shared/projects";
import { group } from "./logFormat";
import { cleanCapturedPageText } from "./pipeline/cleanCapturedText";
import {
  fetchPendingNoteRequests,
  findItemForPageUrl,
  insertQueuedItem,
  promoteItemToWholePage,
  QUEUE_PRIORITY,
  raiseItemPriority,
  requeueItem,
  resolveNoteRequest,
  resolveProjectId,
  type NoteRequestRow,
} from "./db";
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
    project_id: await resolveProjectId({ slug: WEB_PROJECT_SLUG }),
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
  const pending = await fetchPendingNoteRequests();
  // Every count in the run log says what period it covers. These are the
  // requests that arrived since the last cycle drained the inbox, which is not
  // the same as "today" and not the same as "ever".
  console.log("\nREADER REQUESTS · new since the last cycle");
  if (pending.length === 0) {
    console.log("  none");
    return;
  }
  let queued = 0;
  let alreadyChecked = 0;
  let failed = 0;
  const detail: string[] = [];
  for (const request of pending) {
    try {
      const outcome = await consumeNoteRequest(request);
      if (outcome.startsWith("already checked")) alreadyChecked++;
      else queued++;
      detail.push(`     ${outcome}`);
    } catch (err: any) {
      // A broken request must not block the rest of the inbox. The failure is
      // recorded on the request row, where a human sees it and can set the row
      // back to pending after fixing the cause.
      await resolveNoteRequest(request.id, "error", err?.message ?? "unknown", null);
      failed++;
      detail.push(`     could not read ${request.page_url}: ${err?.message}`);
    }
  }
  console.log(`  ${queued} page${queued === 1 ? "" : "s"} readers asked for ${queued === 1 ? "is" : "are"} now in the queue`);
  if (alreadyChecked > 0) {
    console.log(`  ${alreadyChecked} pointed at a page we had already checked, so we answered without redoing it`);
  }
  console.log(`  ${failed} could not be read`);
  const detailLog = group(`each of the ${pending.length}`, detail);
  if (detailLog) console.log(detailLog);
}

export async function consumeRequests(): Promise<void> {
  await consumeNoteRequests();
}

if (import.meta.main) {
  consumeRequests().catch((err) => {
    console.error("[consumeRequests] Fatal error:", err);
    process.exit(1);
  });
}
