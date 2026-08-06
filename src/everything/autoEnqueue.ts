/**
 * Auto-enqueue the next unprocessed content of the priority feeds
 * (see priorityFeeds.ts) — run by the everything-priority-feeds workflow
 * right before the worker drains the queue.
 *
 * Selection per feed: fetch the latest entries (Substack archive API /
 * YouTube channel /videos tab — both newest first), drop the ones that
 * already have an everything_items row (any status — done-with-zero-notes
 * and errored count as processed), and take the remaining entries oldest
 * first, so coverage advances chronologically. The feed window (~15-20
 * entries) bounds how far back this can ever reach.
 *
 * Usage:
 *   bun run src/everything/autoEnqueue.ts [--dry-run]
 */

import "dotenv/config";
import { enqueueItems, fetchItemUrlsContaining, fetchItemUrlsIn, markOrphanedProcessingAsError, resolveProjectId, type EnqueueRow } from "./db";
import { BATCH_SIZE, PRIORITY_FEEDS, type PriorityFeed } from "./priorityFeeds";
import { ARCHIVE_FETCH_LIMIT, fetchArchivePosts } from "./sources/substack";
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
}

/** A feed's latest entries, newest first. */
async function fetchFeedEntries(feed: PriorityFeed): Promise<FeedEntry[]> {
  if (feed.type === "substack") {
    const posts = await fetchArchivePosts(feed.publicationUrl, ARCHIVE_FETCH_LIMIT);
    return posts.map((p) => ({ source: "substack" as const, url: p.url, matchKey: p.url, label: `${p.postDate.slice(0, 10)} ${p.title}` }));
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

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  ensureYtDlp();

  if (!dryRun) {
    const orphaned = await markOrphanedProcessingAsError();
    for (const url of orphaned) console.log(`Orphaned in processing → error: ${url}`);
  }

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
    return;
  }
  for (const { feed, entry } of picks) console.log(`  → [${feed.project}] ${entry.label} — ${entry.url}`);
  if (dryRun) {
    console.log("Dry run — nothing enqueued");
    return;
  }

  const rows: EnqueueRow[] = [];
  for (const { feed, entry } of picks) {
    rows.push({ project_id: await resolveProjectId(feed.project), source: entry.source, url: entry.url });
  }
  const inserted = await enqueueItems(rows);
  console.log(`Enqueued ${inserted} item(s)`);
}

main().catch((err) => {
  console.error("[autoEnqueue] Fatal error:", err);
  process.exit(1);
});
