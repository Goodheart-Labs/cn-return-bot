/**
 * Puts pages that were already checked back at the top of the post list for
 * a full new check. A reader's request cannot do this: intake answers a
 * request on a finished page with "page was already checked". The notes and
 * claims the page has are kept. The page is marked requested, so only the
 * reservations made from now on count on it (GOO-791).
 *
 *   bun run src/everything/recheck.ts <page url> [<page url> ...]
 *
 * From GitHub: the workflow "Recheck Pages" runs this with the service key.
 */
import "dotenv/config";
import { findItemForPageUrl, markItemRequested, requeueItem } from "./db";

export type RecheckOutcome = "queued" | "unknown page" | "already waiting" | "a worker is on it";

export async function recheckPage(pageUrl: string): Promise<RecheckOutcome> {
  const item = await findItemForPageUrl(pageUrl);
  if (!item) return "unknown page";
  if (item.status === "processing") return "a worker is on it";
  if (item.status === "queued") return "already waiting";
  await requeueItem(item.id);
  await markItemRequested(item.id);
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
