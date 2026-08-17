/**
 * Auto-enqueue the next unprocessed content of the feeds we keep fact-checked.
 * The feeds live in everything_followed_feeds: reader-requested follows are
 * walked first, then the curated ones migration 077 seeded, in their stored
 * order. The everything-priority-feeds workflow runs this right before the
 * worker drains the queue.
 *
 * For every feed we fetch its latest entries, newest first. A Substack feed
 * comes from its RSS feed, which goes through our Cloudflare Worker when we run
 * in CI. A YouTube feed comes from the channel's /videos tab. We then drop
 * every entry that already has an everything_items row. Any status counts as
 * processed, including an item that finished with zero notes and an item that
 * errored. The entries that are left are enqueued newest first. New posts must
 * never wait behind an old backlog; a gap further back is acceptable and a
 * later run fills it once the feed is otherwise caught up. A feed only lists
 * its 15 to 20 latest entries, and that bounds how far back this can ever
 * reach.
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
  fetchFollowedFeeds,
  fetchItemClaims,
  fetchItemUrlsContaining,
  fetchItemUrlsIn,
  fetchOrphanedProcessingItems,
  markItemError,
  requeueItem,
  resolveProjectId,
  type EnqueueRow,
} from "./db";
import { fetchFeedPosts, htmlToText } from "./sources/substack";
import { ensureYtDlp, fetchChannelVideos } from "./sources/youtube";
import type { SourceKind } from "./types";

/** How many items one run enqueues, and therefore processes, across all feeds. */
const BATCH_SIZE = 1;
const CHANNEL_FETCH_LIMIT = 15;

/** A followed feed in the shape the fetchers work with. */
export type PriorityFeed =
  | { project: string; type: "substack"; publicationUrl: string }
  | { project: string; type: "youtube"; channelUrl: string };

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

/** The feed's unprocessed entries, newest first. */
async function unprocessedEntries(feed: PriorityFeed, entries: FeedEntry[]): Promise<FeedEntry[]> {
  const knownUrls =
    feed.type === "substack"
      ? await fetchItemUrlsIn(entries.map((e) => e.matchKey))
      : await fetchItemUrlsContaining(entries.map((e) => e.matchKey));
  return entries.filter((e) => !knownUrls.some((url) => url.includes(e.matchKey)));
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

/** The feeds to walk. fetchFollowedFeeds already returns them in walk order:
 *  reader-followed feeds first, because their items also rank above the
 *  curated backlog in the queue, then the curated feeds in their stored
 *  order. */
async function feedsToWalk(): Promise<{ feed: PriorityFeed; priority: number }[]> {
  return (await fetchFollowedFeeds()).map((f) => ({
    feed:
      f.feed_type === "substack"
        ? { project: f.project_slug, type: "substack" as const, publicationUrl: f.feed_url }
        : { project: f.project_slug, type: "youtube" as const, channelUrl: f.feed_url },
    priority: f.priority,
  }));
}

/** Runs one pass of triage, selection, and enqueueing. Returns how many items
 *  were enqueued. */
export async function runAutoEnqueue(dryRun = false): Promise<number> {
  if (!dryRun) await triageOrphanedItems();

  const picks: { feed: PriorityFeed; priority: number; entry: FeedEntry }[] = [];
  for (const { feed, priority } of await feedsToWalk()) {
    if (picks.length >= BATCH_SIZE) break;
    const entries = await fetchFeedEntries(feed);
    const unprocessed = await unprocessedEntries(feed, entries);
    console.log(`[${feed.project}] ${entries.length} feed entries, ${unprocessed.length} unprocessed`);
    for (const entry of unprocessed.slice(0, BATCH_SIZE - picks.length)) picks.push({ feed, priority, entry });
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
  for (const { feed, priority, entry } of picks) {
    rows.push({
      project_id: await resolveProjectId(feed.project),
      source: entry.source,
      url: entry.url,
      title: entry.title,
      full_text: entry.fullText,
      published_at: entry.publishedAt,
      priority,
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
