/**
 * Puts pages that were already checked back in the queue for a full new
 * check. A reader's request cannot do this: intake answers a request on a
 * finished page with "page was already checked". The notes and claims the
 * page has are kept, and every subscribed notewriter gets the page again,
 * because a new stay in the queue starts (everything_items.queued_at).
 *
 * The page goes first among the feed posts, not into the reader-request tier,
 * which only notewriters that take reader requests are handed.
 *
 *   bun run src/everything/recheck.ts <page url> [<page url> ...]
 *
 * From GitHub: the workflow "Recheck Pages" runs this with the service key.
 */
import "dotenv/config";
import { findItemForPageUrl, QUEUE_PRIORITY, raiseItemPriority, requeueItem } from "./db";

export type RecheckOutcome = "queued" | "unknown page" | "already waiting" | "a worker is on it";

export async function recheckPage(pageUrl: string): Promise<RecheckOutcome> {
  const item = await findItemForPageUrl(pageUrl);
  if (!item) return "unknown page";
  if (item.status === "processing") return "a worker is on it";
  if (item.status === "queued") return "already waiting";
  await requeueItem(item.id);
  await raiseItemPriority(item.id, QUEUE_PRIORITY.prioritized);
  return "queued";
}

if (import.meta.main) {
  const urls = process.argv.slice(2).flatMap((arg) => arg.split(/\s+/)).filter(Boolean);
  if (!urls.length) throw new Error("Give at least one page address.");
  let unknown = 0;
  for (const url of urls) {
    const outcome = await recheckPage(url);
    console.log(`${outcome}: ${url}`);
    if (outcome === "unknown page") unknown++;
  }
  if (unknown) process.exit(1);
}
