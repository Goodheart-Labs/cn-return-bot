/**
 * Auto-enqueue the next unprocessed post of the creators we keep fact-checked.
 * The everything-priority-feeds workflow runs this at the start of every feed
 * run when nothing is waiting in the feed tiers of the queue.
 *
 * The walk is one straight line (Jim's design, GOO-225). It goes down the
 * creator ranking from the top: creators holding priority first, then
 * everyone by readers (see creatorRanking.ts). At each creator it asks one
 * question: does this creator have a post we have not checked? A post counts
 * if it is among the creator's five newest, or among their all-time top posts
 * (GOO-81, see topPosts.ts). The first creator with such a post gets it
 * enqueued, and the walk stops there. The newest unchecked recent post goes
 * first, and after those the most popular unchecked top post.
 *
 * Only a feed's five newest posts are ever candidates. A newly ranked creator
 * therefore backfills at most five posts rather than their whole archive. A
 * gap deeper than that stays unfilled on purpose. A post counts as checked
 * when it has a whole-page everything_items row in any status, including one
 * that finished with zero notes; an errored item is handled by the retry sweep
 * instead.
 *
 * Where the posts come from: a Substack feed from its RSS feed, which goes
 * through our Cloudflare Worker when we run in CI; a forum author from the
 * LessWrong GraphQL API; a YouTube channel from its stored listing, which the
 * Data API refreshes only when YouTube told us the channel published
 * something or the listing is a day old (see youtubeChannels.ts). Asking the
 * Data API about every channel on every run used up the daily quota by the
 * afternoon.
 *
 * A Substack post is enqueued with its RSS body already in full_text. That way
 * the worker never has to fetch Substack, which blocks our CI runners.
 *
 * Usage:
 *   bun run src/everything/autoEnqueue.ts [--dry-run]
 */

import "dotenv/config";
import { extractYoutubeVideoId } from "../everything-core/pageUrls";
import { rankCreators, type RankedCreator } from "./creatorRanking";
import { MIN_PAGES_FOR_A_READER, VISIT_RANKING_WINDOW_DAYS } from "../everything-core/readers";
import {
  countYoutubeNotifications,
  enqueueItems,
  fetchAllTopPosts,
  fetchItemClaims,
  fetchItemUrlsContaining,
  fetchItemUrlsIn,
  fetchOrphanedProcessingItems,
  fetchRetryableErrorItems,
  markItemError,
  promoteItemToWholePage,
  requeueErroredItem,
  requeueItem,
  resolveProjectId,
  type KnownItemUrl,
  type TopPostRow,
} from "./db";
import type { FeedType } from "./feedUrls";
import { fixedRow, groupClose, groupOpen, tally } from "./logFormat";
import { fetchAuthorPosts } from "./sources/lesswrong";
import { fetchFeedPosts, fetchPostBodyText, htmlToText } from "./sources/substack";
import { quotaRanOutThisRun } from "./sources/youtubeDataApi";
import { refreshOneStaleTopList } from "./topPosts";
import type { SourceKind } from "./types";
import { RESUBSCRIBE_AFTER_DAYS, youtubeChannelUploads, type ListingReason } from "./youtubeChannels";

/** Only a feed's newest posts are ever candidates, and a YouTube or forum
 *  listing fetches no more than these. A newly ranked creator therefore
 *  backfills at most this many posts. Whole-window backfills used to eat the
 *  daily spend cap; one follow brought in archive posts years old while fresh
 *  posts from other feeds waited. A gap deeper than this window stays
 *  unfilled on purpose. */
const FEED_CANDIDATE_LIMIT = 5;

/** A creator's feed in the shape the fetchers work with. `url` is the feed's
 *  canonical URL: a Substack publication root, a YouTube channel, or a forum
 *  author's profile. */
export interface PriorityFeed {
  project: string;
  type: FeedType;
  url: string;
}

interface FeedEntry {
  source: SourceKind;
  url: string;
  /** What to match existing item urls against. For YouTube this is the video
   *  id and for a forum post the post id, because the stored URL forms vary.
   *  For Substack it is the canonical url itself. */
  matchKey: string;
  label: string;
  /** The post body, when the feed listing already carries it. A Substack body
   *  comes from the RSS feed and a forum body from the GraphQL listing. We
   *  enqueue it with the item so the worker never has to fetch the page. */
  fullText?: string;
  title?: string;
  publishedAt?: string;
  /** Set when the entry is one of the creator's all-time top posts rather
   *  than a recent one: the platform's popularity count (views or likes).
   *  Such entries rank behind the creator's recent posts. */
  topPopularity?: number;
}

/** A feed's newest entries, newest first, the source's display name, and how
 *  many paid posts were left out. */
interface FeedListing {
  sourceName?: string;
  entries: FeedEntry[];
  /** Paid posts we cannot read. Counted rather than listed: Slow Boring alone
   *  used to print sixteen lines a cycle, which buried everything else. */
  paidPosts: number;
  /** For a YouTube channel: why the Data API was asked this time, or null when
   *  the stored listing was used. Undefined for the other feed types, which
   *  are always fetched live because they cost nothing. */
  listedBecause?: ListingReason | null;
}

async function fetchFeedEntries(feed: PriorityFeed): Promise<FeedListing> {
  if (feed.type === "substack") {
    const { title: sourceName, posts } = await fetchFeedPosts(feed.url);
    // A paid post's RSS body is only the free preview. Fact-checking a
    // fragment gives bad results, so the automated path leaves paid posts out.
    // Someone enqueues them by hand with the full text from a subscriber inbox,
    // using `everything-enqueue --doc <canonical-url> <file>`. The item row
    // that creates then marks the post processed here.
    const paidPosts = posts.filter((p) => p.paywalled).length;
    const entries = posts
      .filter((p) => !p.paywalled)
      .slice(0, FEED_CANDIDATE_LIMIT)
      .map((p) => ({
        source: "substack" as const,
        url: p.url,
        matchKey: p.url,
        label: `${p.publishedAt.slice(0, 10)} ${p.title}`,
        fullText: htmlToText(p.bodyHtml, true),
        title: p.title,
        publishedAt: p.publishedAt.slice(0, 10),
      }));
    return { sourceName, entries, paidPosts };
  }
  if (feed.type === "lesswrong") {
    const { authorName, posts } = await fetchAuthorPosts(feed.url, FEED_CANDIDATE_LIMIT);
    const entries = posts.map((p) => ({
      source: "lesswrong" as const,
      url: p.url,
      matchKey: p.postId,
      label: `${p.postedAt.slice(0, 10)} ${p.title}`,
      fullText: p.text,
      title: p.title,
      publishedAt: p.postedAt.slice(0, 10),
    }));
    return { sourceName: authorName, entries, paidPosts: 0 };
  }
  const { title, uploads, listedBecause } = await youtubeChannelUploads(feed.url, FEED_CANDIDATE_LIMIT);
  const entries = uploads
    // An upcoming premiere cannot be watched yet, and enqueueing it would
    // leave the item in a permanent error state. The listing after it airs
    // picks it up, because YouTube notifies us when it does.
    .filter((v) => !v.upcoming)
    .map((v) => ({
      source: "youtube" as const,
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      matchKey: v.videoId,
      label: `${v.publishedAt} ${v.title}`,
      title: v.title,
      publishedAt: v.publishedAt,
    }));
  return { sourceName: title, entries, paidPosts: 0, listedBecause };
}

/** A feed entry that still needs a whole-page check. Most carry no item row
 *  at all and are enqueued fresh. An entry whose item exists but was never a
 *  whole-page check, because a reader wrote a note on the page or one
 *  paragraph was checked, carries that item so the walker can promote it
 *  instead of skipping it forever. */
type UnprocessedEntry = FeedEntry & { existingItem: KnownItemUrl | null };

/** The feed's unprocessed entries, newest first. An entry whose item is a
 *  whole-page check, in whatever status, is genuinely handled and dropped.
 *  Exported for the tests, which mock the db module underneath it. */
export async function unprocessedEntries(feed: PriorityFeed, entries: FeedEntry[]): Promise<UnprocessedEntry[]> {
  const known =
    feed.type === "substack"
      ? await fetchItemUrlsIn(entries.map((e) => e.matchKey))
      : await fetchItemUrlsContaining(entries.map((e) => e.matchKey));
  return entries
    .map((e) => ({ ...e, existingItem: known.find((k) => k.url.includes(e.matchKey)) ?? null }))
    .filter((e) => e.existingItem === null || e.existingItem.checked_scope !== "page");
}

/** Decide what happens to items that a killed run left behind in "processing".
 *
 *  If the item already has claims in the database, the expensive extraction
 *  step finished before the kill, and every claim that completed its check is
 *  already saved. We put such an item back in the queue, and the worker will
 *  redo only the unfinished claims.
 *
 *  If the item has no claims yet, the run died during extraction, and a resume
 *  would repeat the whole extraction. So we mark it as an error instead. The
 *  retry sweep below then gives it a bounded number of fresh attempts, and if
 *  extraction is what keeps killing the run, the item stays in error for a
 *  human to look at rather than looping forever.
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

/** How many repeat attempts an errored item gets before it stays an error a
 *  human has to look at. */
const MAX_ITEM_RETRIES = 2;

/** How long an errored item rests before its next attempt. */
const RETRY_COOLDOWN_HOURS = 6;

/** Puts errored items back in the queue for a bounded number of repeat
 *  attempts. Most of our item errors have been transient: a flagged proxy IP
 *  that made a transcript look missing, or an exhausted API key. Without a
 *  retry each of those failures killed its item forever, because the feed
 *  walker treats every existing whole-page item as processed. Retried items
 *  drain at the retry tier, so they never delay fresh content, and an item
 *  rests between attempts so a cause that lasts a while does not burn every
 *  retry at once. An item that still fails after its retries stays in error,
 *  and the row's error text says why. */
async function retryErroredItems(): Promise<void> {
  for (const item of await fetchRetryableErrorItems(MAX_ITEM_RETRIES, RETRY_COOLDOWN_HOURS)) {
    await requeueErroredItem(item);
    console.log(`Errored item requeued for attempt ${item.retries + 2}/${MAX_ITEM_RETRIES + 1}: ${item.url}`);
  }
}

/** Turns a feed's cached top posts into feed entries, leaving out the ones
 *  already among the feed's recent entries so a recent viral post is not a
 *  candidate twice. Exported for the tests. */
export function topPostEntries(tops: TopPostRow[], recent: FeedEntry[]): FeedEntry[] {
  return tops
    .map((t) => ({
      source: t.source,
      url: t.url,
      matchKey: t.source === "youtube" ? extractYoutubeVideoId(t.url) ?? t.url : t.url,
      label: `all-time #${t.rank} (${t.popularity.toLocaleString("en-US")}) ${t.title ?? t.url}`,
      title: t.title ?? undefined,
      publishedAt: t.published_at?.slice(0, 10),
      topPopularity: t.popularity,
    }))
    .filter((t) => !recent.some((e) => e.matchKey === t.matchKey));
}

/** Puts back what a killed run stranded and gives errored items their repeat
 *  attempts. The feed run does this at its start, before it looks at the
 *  queue, because both steps only touch the database and a requeued item must
 *  be visible to the "is anything waiting" question that decides whether to
 *  walk. Both steps assume no worker is active, which the workflow's
 *  concurrency group guarantees. */
export async function triageQueue(): Promise<void> {
  await triageOrphanedItems();
  await retryErroredItems();
}

const DAY_MS = 24 * 3600_000;

/** Goes down the ranked creators from the top and stops at the first one whose
 *  walk found something unchecked. A creator whose walk returns null could not
 *  be listed and is passed over. `walked` holds every creator that was listed,
 *  including the one the walk stopped at. Exported for the tests, which
 *  inject the walk. */
export async function walkToFirstUnchecked<C, W extends { unchecked: unknown[] }>(
  ranked: C[],
  walk: (creator: C, index: number) => Promise<W | null>,
): Promise<{ walked: C[]; unlisted: number; found: { creator: C; index: number; walk: W } | null }> {
  const walked: C[] = [];
  let unlisted = 0;
  for (const [index, creator] of ranked.entries()) {
    const result = await walk(creator, index);
    if (!result) {
      unlisted++;
      continue;
    }
    walked.push(creator);
    if (result.unchecked.length > 0) return { walked, unlisted, found: { creator, index, walk: result } };
  }
  return { walked, unlisted, found: null };
}

/** Column widths of the walk table, fixed so rows can print as they arrive. */
const CREATOR_COLUMNS = [4, 24, 20, 7, 5, 6, 16, 9];
const CREATOR_ALIGN: ("left" | "right")[] = ["right", "left", "left", "right", "right", "right", "left", "right"];

/** How much of a creator's priority window is left, for the walk table. Rounded
 *  down to whole days, because the exact hour is not worth a column. */
function priorityLeft(priorityUntil: string | null): string {
  if (!priorityUntil) return "0d";
  const days = Math.floor((Date.parse(priorityUntil) - Date.now()) / DAY_MS);
  return days >= 1 ? `${days}d` : "<1d";
}

/** Where a creator's posts came from this run, for the walk table. A YouTube
 *  channel says whether the Data API was asked, and why. */
function listingSource(feed: PriorityFeed, listing: FeedListing): string {
  if (feed.type === "substack") return "rss";
  if (feed.type === "lesswrong") return "forum api";
  return listing.listedBecause ? `listed, ${listing.listedBecause}` : "stored";
}

/** What one creator's walk found. */
interface CreatorWalk {
  feed: PriorityFeed;
  sourceName?: string;
  /** Recent posts first, newest first, then top posts by popularity. The walk
   *  enqueues the first. */
  unchecked: UnprocessedEntry[];
}

/** The two YouTube lines at the end of the walk: how many channels the Data API
 *  was asked about, and whether YouTube's notifications are arriving. A hub
 *  that stopped sending shows up as zero notified channels. */
async function logYoutubeListings(listings: (ListingReason | null)[]): Promise<void> {
  if (listings.length === 0) return;
  const listed = listings.filter((reason) => reason !== null);
  const reasons = new Map<string, number>();
  for (const reason of listed) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  const now = Date.now();
  const { notified, subscribed } = await countYoutubeNotifications(
    new Date(now - DAY_MS),
    new Date(now - RESUBSCRIBE_AFTER_DAYS * DAY_MS),
  );
  console.log(
    `  YouTube · ${listed.length} of ${listings.length} channels asked the Data API${listed.length ? ` (${tally(reasons)})` : ""}, the rest read their stored listing`,
  );
  console.log(`  YouTube · channels the hub told us about in the last 24 hours: ${notified} · channels subscribed: ${subscribed}`);
  if (quotaRanOutThisRun()) console.log(`  YouTube · the Data API quota is used up until 07:00 UTC · this run will fail at the end so it is seen`);
}

/** Enqueues one post. An entry whose item row already exists is promoted to a
 *  whole-page check in place, keeping its claims and notes. A Substack
 *  promotion carries the RSS body, the same text a fresh enqueue would have
 *  carried; a YouTube one carries none and the worker fetches the transcript. */
async function enqueueEntry(creator: RankedCreator, walk: CreatorWalk, entry: UnprocessedEntry): Promise<void> {
  const { feed, sourceName } = walk;
  // An all-time top Substack post is too old to appear in the RSS feed, so
  // its body is fetched here through the API, one call for the picked post.
  // If that fails the item is enqueued bare, and the worker's web-fetch
  // ladder is the fallback.
  if (feed.type === "substack" && entry.topPopularity !== undefined && !entry.fullText) {
    try {
      entry.fullText = await fetchPostBodyText(feed.url, entry.url);
    } catch (err: any) {
      console.warn(`  body fetch failed for ${entry.url}: ${err?.message}`);
    }
  }
  if (entry.existingItem) {
    await promoteItemToWholePage(entry.existingItem.id, entry.fullText ?? null, creator.priority);
    console.log(`  promoted to a whole-page check: ${entry.url}`);
    return;
  }
  await enqueueItems([
    {
      project_id: await resolveProjectId({ slug: feed.project, displayName: sourceName, feedUrl: feed.url }),
      source: entry.source,
      url: entry.url,
      title: entry.title,
      full_text: entry.fullText,
      // The candidate's date also covers YouTube, whose upload date the
      // listing already carries. Setting it here keeps the queue's own
      // ordering honest from the start.
      published_at: entry.publishedAt,
      priority: creator.priority,
    },
  ]);
  console.log(`  enqueued`);
}

/** Walks the ranking to the first creator with an unchecked post and enqueues
 *  that post. Returns how many items were enqueued or promoted: one, or zero
 *  when every ranked creator is caught up. */
export async function runAutoEnqueue(dryRun = false): Promise<number> {
  const ranked = await rankCreators();
  // The cached top lists serve this walk. The stalest walked creator's list is
  // refreshed after the walk, and the fresh rows serve the next run.
  const topRows = await fetchAllTopPosts();

  const skipped: string[] = [];
  const paidByCreator = new Map<string, number>();
  const youtubeListings: (ListingReason | null)[] = [];

  // Each creator's row is printed the moment their feed has been listed, so a
  // slow walk never reads as a hang.
  const byPriority = ranked.filter((c) => c.prioritized).length;
  console.log(
    `\nCREATORS · ${ranked.length} ranked · ${byPriority} by priority, ${ranked.length - byPriority} by attention · ranked by readers, a browser that opened at least ${MIN_PAGES_FOR_A_READER} different pages · counted over the last ${VISIT_RANKING_WINDOW_DAYS} days`,
  );
  console.log(`  walked from the top until a creator has a post we have not checked`);
  console.log(groupOpen("the walk, in rank order"));
  console.log(
    fixedRow(["rank", "creator", "why", "readers", "pages", "visits", "listing", "unchecked"], CREATOR_COLUMNS, CREATOR_ALIGN),
  );

  const walkCreator = async (creator: RankedCreator, feedIndex: number): Promise<CreatorWalk | null> => {
    const feed: PriorityFeed = { project: creator.project_slug, type: creator.feed_type, url: creator.feed_url };
    let listing: FeedListing;
    try {
      listing = await fetchFeedEntries(feed);
    } catch (err: any) {
      // One creator whose feed will not load must not take the run down with
      // it. Readers can prioritise anyone, so an unreachable feed is ordinary
      // rather than exceptional. An exhausted YouTube quota is the exception,
      // and the feed run fails at its end for it (see autoRun.ts).
      skipped.push(`  could not list ${feed.project}: ${err?.message ?? "unknown error"}`);
      console.log(fixedRow([String(feedIndex + 1), feed.project, "could not list", "", "", "", "", ""], CREATOR_COLUMNS, CREATOR_ALIGN));
      return null;
    }
    if (listing.paidPosts > 0) paidByCreator.set(feed.project, listing.paidPosts);
    if (listing.listedBecause !== undefined) youtubeListings.push(listing.listedBecause);
    const tops = topPostEntries(topRows.filter((t) => t.feed_url === feed.url), listing.entries);
    const unchecked = await unprocessedEntries(feed, [...listing.entries, ...tops]);
    console.log(
      fixedRow(
        [
          String(feedIndex + 1),
          feed.project,
          creator.prioritized ? `priority, ${priorityLeft(creator.priorityUntil)} left` : "attention",
          String(creator.readers),
          String(creator.pages),
          String(creator.visits),
          listingSource(feed, listing),
          String(unchecked.length),
        ],
        CREATOR_COLUMNS,
        CREATOR_ALIGN,
      ),
    );
    return { feed, sourceName: listing.sourceName, unchecked };
  };

  const { walked, unlisted, found } = await walkToFirstUnchecked(ranked, walkCreator);

  const closing = groupClose();
  if (closing) console.log(closing);
  console.log(`  walked ${walked.length + unlisted} of ${ranked.length}${unlisted ? `, ${unlisted} could not be listed` : ""}`);
  for (const line of skipped) console.log(line);
  if (paidByCreator.size > 0) {
    console.log(`  paid posts we cannot read, waiting for the subscriber inbox: ${tally(paidByCreator)}`);
  }
  await logYoutubeListings(youtubeListings);
  // The top-posts refresh is spent on a creator we actually walked. Its fresh
  // rows are in the table for the next run; this one used the cache.
  if (!dryRun) await refreshOneStaleTopList(walked);

  if (!found) {
    console.log("\nQUEUE · nothing to add, every ranked creator is caught up");
    return 0;
  }
  const entry = found.walk.unchecked[0]!;
  console.log(`\n  adding: [${found.walk.feed.project}] ${entry.label}`);
  console.log(`          ${entry.url}`);
  if (dryRun) {
    console.log("Dry run, nothing enqueued");
    return 0;
  }
  await enqueueEntry(found.creator, found.walk, entry);
  return 1;
}

if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  (dryRun ? Promise.resolve() : triageQueue())
    .then(() => runAutoEnqueue(dryRun))
    .catch((err) => {
      console.error("[autoEnqueue] Fatal error:", err);
      process.exit(1);
    });
}
