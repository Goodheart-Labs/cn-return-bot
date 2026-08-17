/**
 * Auto-enqueue the next unprocessed content of the priority feeds listed in
 * priorityFeeds.ts. The everything-priority-feeds workflow runs this right
 * before the worker drains the queue.
 *
 * For every feed we fetch its latest entries, newest first. A Substack feed
 * comes from its RSS feed, which goes through our Cloudflare Worker when we run
 * in CI. A YouTube feed comes from the channel's /videos tab. We then drop
 * every entry that already has an everything_items row. Any status counts as
 * processed, including an item that finished with zero notes and an item that
 * errored. The entries that are left are enqueued oldest first, so coverage
 * advances chronologically. A feed only lists its 15 to 20 latest entries, and
 * that bounds how far back this can ever reach.
 *
 * A Substack post is enqueued with its RSS body already in full_text. That way
 * the worker never has to fetch Substack, which blocks our CI runners.
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
  /** What to match existing item urls against. For YouTube this is the video
   *  id, because the stored URL forms vary. For Substack it is the canonical
   *  url itself. */
  matchKey: string;
  label: string;
  /** Substack only. This is the post body taken from the RSS feed. We enqueue
   *  it with the item so the worker never has to fetch Substack, which blocks
   *  our CI runners. */
  fullText?: string;
  title?: string;
  publishedAt?: string;
}

/** A feed's latest entries, newest first. */
async function fetchFeedEntries(feed: PriorityFeed): Promise<FeedEntry[]> {
  if (feed.type === "substack") {
    const posts = await fetchFeedPosts(feed.publicationUrl);
    // A paid post's RSS body is only the free preview. Fact-checking a
    // fragment gives bad results, so the automated path leaves paid posts out.
    // Someone enqueues them by hand with the full text from a subscriber inbox,
    // using `everything-enqueue --doc <canonical-url> <file>`. The item row
    // that creates then marks the post processed here.
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
    // A video with no duration is an upcoming premiere. It cannot be watched
    // yet, and enqueueing it would leave the item in a permanent error state.
    // A later run picks it up once the video is live.
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
 *  run, that could repeat forever. So we mark it as an error instead. A human
 *  sees it and can put it back in the queue by hand.
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

/** Runs one pass of triage, selection, and enqueueing. Returns how many items
 *  were enqueued. */
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
