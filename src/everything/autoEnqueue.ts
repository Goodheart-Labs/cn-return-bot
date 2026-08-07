/**
 * Auto-enqueue the next unprocessed content of the priority feeds
 * (see priorityFeeds.ts) — run by the everything-priority-feeds workflow
 * right before the worker drains the queue.
 *
 * Selection per feed: fetch the latest entries (Substack RSS feed, proxied
 * through our Cloudflare Worker in CI / YouTube channel /videos tab — both
 * newest first), drop the ones that already have an everything_items row
 * (any status — done-with-zero-notes and errored count as processed), and
 * take the remaining entries oldest first, so coverage advances
 * chronologically. The feed window (~15-20 entries) bounds how far back
 * this can ever reach. Substack posts are enqueued with their RSS body as
 * full_text, so the worker never fetches Substack (blocked from CI).
 *
 * Usage:
 *   bun run src/everything/autoEnqueue.ts [--dry-run]
 */

import "dotenv/config";
import {
  enqueueItems,
  fetchItemClaims,
  fetchItemUrlsContaining,
  fetchItemUrlsIn,
  fetchOrphanedProcessingItems,
  markItemError,
  requeueItem,
  resolveProjectId,
  type EnqueueRow,
} from "./db";
import { BATCH_SIZE, PRIORITY_FEEDS, type PriorityFeed } from "./priorityFeeds";
import { fetchFeedPosts, htmlToText } from "./sources/substack";
import { ensureYtDlp, fetchChannelVideos } from "./sources/youtube";
import type { SourceKind } from "./types";

const CHANNEL_FETCH_LIMIT = 15;

interface FeedEntry {
  source: SourceKind;
  url: string;
  /** What to match existing item urls against (YouTube video id — stored URL
   *  forms vary; Substack the canonical url itself). */
  matchKey: string;
  label: string;
  /** Substack only: the post body from the RSS feed, enqueued with the item so
   *  the worker never fetches Substack (blocked from CI). */
  fullText?: string;
  title?: string;
  publishedAt?: string;
}

/** A feed's latest entries, newest first. */
async function fetchFeedEntries(feed: PriorityFeed): Promise<FeedEntry[]> {
  if (feed.type === "substack") {
    const posts = await fetchFeedPosts(feed.publicationUrl);
    // A paid post's RSS body is only the free preview — fact-checking a
    // fragment misfires, so the automated path leaves paid posts out. They are
    // enqueued separately with the full text from a subscriber inbox
    // (everything-enqueue --doc <canonical-url> <file>), whose item row then
    // marks them processed here.
    for (const p of posts.filter((p) => p.paywalled)) {
      console.log(`[${feed.project}] paid post awaits the subscriber-inbox path: ${p.title}`);
    }
    return posts.filter((p) => !p.paywalled).map((p) => ({
      source: "substack" as const,
      url: p.url,
      matchKey: p.url,
      label: `${p.publishedAt.slice(0, 10)} ${p.title}`,
      fullText: htmlToText(p.bodyHtml, true),
      title: p.title,
      publishedAt: p.publishedAt.slice(0, 10),
    }));
  }
  return fetchChannelVideos(feed.channelUrl, CHANNEL_FETCH_LIMIT)
    // A null duration is an upcoming premiere — not watchable yet, and enqueueing
    // it would error the item permanently. It gets picked up once it's live.
    .filter((v) => v.durationSeconds !== null)
    .map((v) => ({ source: "youtube" as const, url: v.url, matchKey: v.videoId, label: v.title }));
}

/** The feed's unprocessed entries, oldest first. */
async function unprocessedEntries(feed: PriorityFeed, entries: FeedEntry[]): Promise<FeedEntry[]> {
  const knownUrls =
    feed.type === "substack"
      ? await fetchItemUrlsIn(entries.map((e) => e.matchKey))
      : await fetchItemUrlsContaining(entries.map((e) => e.matchKey));
  return entries.filter((e) => !knownUrls.some((url) => url.includes(e.matchKey))).reverse();
}

/** Decide what happens to items that a killed run left behind in "processing".
 *
 *  If the item already has claims in the database, the expensive extraction
 *  step finished before the kill, and every claim that completed its check is
 *  already saved. We put such an item back in the queue, and the worker will
 *  redo only the unfinished claims.
 *
 *  If the item has no claims yet, the run died during extraction. Requeueing
 *  it would repeat the whole extraction, and if extraction is what killed the
 *  run, that could repeat forever. So we mark it as an error instead — a
 *  human sees it and can put it back in the queue by hand.
 *
 *  This only runs while no worker is active. Inside the workflow that is
 *  guaranteed by its concurrency group; for local runs see the warning in
 *  CLAUDE.md. */
async function triageOrphanedItems(): Promise<void> {
  for (const item of await fetchOrphanedProcessingItems()) {
    if ((await fetchItemClaims(item.id)).length > 0) {
      await requeueItem(item.id);
      console.log(`Orphaned in processing → requeued for resume: ${item.url}`);
    } else {
      await markItemError(item.id, "orphaned in processing before claim extraction finished");
      console.log(`Orphaned in processing (no claims) → error: ${item.url}`);
    }
  }
}

/** One triage + selection + enqueue pass; returns how many items were enqueued. */
export async function runAutoEnqueue(dryRun = false): Promise<number> {
  if (!dryRun) await triageOrphanedItems();

  const picks: { feed: PriorityFeed; entry: FeedEntry }[] = [];
  for (const feed of PRIORITY_FEEDS) {
    if (picks.length >= BATCH_SIZE) break;
    const entries = await fetchFeedEntries(feed);
    const unprocessed = await unprocessedEntries(feed, entries);
    console.log(`[${feed.project}] ${entries.length} feed entries, ${unprocessed.length} unprocessed`);
    for (const entry of unprocessed.slice(0, BATCH_SIZE - picks.length)) picks.push({ feed, entry });
  }

  if (picks.length === 0) {
    console.log("All priority feeds are caught up — nothing to enqueue");
    return 0;
  }
  for (const { feed, entry } of picks) console.log(`  → [${feed.project}] ${entry.label} — ${entry.url}`);
  if (dryRun) {
    console.log("Dry run — nothing enqueued");
    return 0;
  }

  const rows: EnqueueRow[] = [];
  for (const { feed, entry } of picks) {
    rows.push({
      project_id: await resolveProjectId(feed.project),
      source: entry.source,
      url: entry.url,
      title: entry.title,
      full_text: entry.fullText,
      published_at: entry.publishedAt,
    });
  }
  const inserted = await enqueueItems(rows);
  console.log(`Enqueued ${inserted} item(s)`);
  return inserted;
}

if (import.meta.main) {
  ensureYtDlp();
  runAutoEnqueue(process.argv.includes("--dry-run")).catch((err) => {
    console.error("[autoEnqueue] Fatal error:", err);
    process.exit(1);
  });
}
