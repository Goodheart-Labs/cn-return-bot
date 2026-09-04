/**
 * Auto-enqueue the next unprocessed content of the feeds we keep fact-checked.
 * The feeds live in everything_followed_feeds, and the walk order comes from
 * the creator ranking: manually flagged creators first, then everyone by
 * reader attention (see creatorRanking.ts). The everything-priority-feeds
 * workflow runs this right before the worker drains the queue.
 *
 * For every feed we fetch its latest entries, newest first. A Substack feed
 * comes from its RSS feed, which goes through our Cloudflare Worker when we run
 * in CI. A YouTube feed comes from the channel's /videos tab. Only a feed's
 * newest few entries are candidates, and we drop every candidate that already
 * has a whole-page everything_items row. Any status counts as processed there,
 * including an item that finished with zero notes; an errored item is handled
 * by the retry sweep instead. The remaining candidates from all feeds are
 * ranked together, by the average of a recency rank and an author-priority
 * rank, and the best ones are enqueued. New posts must never wait behind an
 * old backlog. A gap deeper than the candidate window is left unfilled on
 * purpose.
 *
 * Each creator's all-time top posts join the candidates too (GOO-81, see
 * topPosts.ts). In the author rank they line up behind the creator's recent
 * posts, ordered by popularity, and in the recency rank they carry their real
 * old publish dates. Nothing gates them beyond that. Sitting last in both
 * ranks is what keeps them at the back, so in practice an evergreen hit is
 * picked on a run where the feeds are otherwise caught up. The one case where
 * a top post comes early is a flagged creator: flagged candidates are ranked
 * ahead of everyone else, so a creator you flagged who has no unchecked new
 * posts contributes their top posts next. That is what flagging is for.
 *
 * A Substack post is enqueued with its RSS body already in full_text. That way
 * the worker never has to fetch Substack, which blocks our CI runners.
 *
 * Usage:
 *   bun run src/everything/autoEnqueue.ts [--dry-run]
 */

import "dotenv/config";
import { extractYoutubeVideoId } from "../everything-shared/pageUrls";
import { rankCreators, VISIT_RANKING_WINDOW_DAYS, type RankedCreator } from "./creatorRanking";
import {
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
  type EnqueueRow,
  type KnownItemUrl,
  type TopPostRow,
} from "./db";
import { canonicalFeed, type FeedType } from "./feedUrls";
import { group, table, tally } from "./logFormat";
import { fetchFeedPosts, fetchPostBodyText, htmlToText } from "./sources/substack";
import { ensureYtDlp, fetchChannelVideos, fetchVideoMeta } from "./sources/youtube";
import { loadTopPosts } from "./topPosts";
import type { SourceKind } from "./types";

/** How many items one run enqueues, and therefore processes, across all feeds. */
const BATCH_SIZE = 1;
/** How many entries a feed listing fetches. Substack's RSS feed has its own
 *  fixed window of about twenty. */
const FEED_FETCH_LIMIT = 15;
/** Only a feed's newest posts are ever candidates. A newly followed creator
 *  therefore backfills at most this many posts, instead of their whole 15 to
 *  20 entry feed window. Whole-window backfills used to eat the daily spend
 *  cap; one follow brought in archive posts years old while fresh posts from
 *  other feeds waited. A gap deeper than this window stays unfilled on
 *  purpose. */
const FEED_CANDIDATE_LIMIT = 5;

/** A creator's feed in the shape the fetchers work with. `url` is the feed's
 *  canonical URL: a Substack publication root or a YouTube channel. */
export interface PriorityFeed {
  project: string;
  type: FeedType;
  url: string;
}

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
  /** Set when the entry is one of the creator's all-time top posts rather
   *  than a recent one: the platform's popularity count (views or likes).
   *  Such entries rank behind the creator's recent posts. */
  topPopularity?: number;
}

/** A feed's latest entries, newest first, the source's display name, and how
 *  many paid posts were left out. */
interface FeedListing {
  sourceName?: string;
  entries: FeedEntry[];
  /** Paid posts we cannot read. Counted rather than listed: Slow Boring alone
   *  used to print sixteen lines a cycle, which buried everything else. */
  paidPosts: number;
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
    const entries = posts.filter((p) => !p.paywalled).map((p) => ({
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
  const { channelName, videos } = fetchChannelVideos(feed.url, FEED_FETCH_LIMIT);
  const entries = videos
    // A video with no duration is an upcoming premiere. It cannot be watched
    // yet, and enqueueing it would leave the item in a permanent error state.
    // A later run picks it up once the video is live.
    .filter((v) => v.durationSeconds !== null)
    .map((v) => ({ source: "youtube" as const, url: v.url, matchKey: v.videoId, label: v.title }));
  return { sourceName: channelName, entries, paidPosts: 0 };
}

/** Feed listings fetched this process, keyed by feed URL. The cycles of one
 *  dispatch reuse them, so a growing feed set does not multiply listing
 *  fetches by the cycle count; a post published mid-dispatch simply waits for
 *  the next dispatch. The unprocessed check against the database still runs
 *  every cycle, so an entry enqueued in an earlier cycle is not picked again. */
const feedListingCache = new Map<string, FeedListing>();

async function cachedFeedEntries(feed: PriorityFeed): Promise<FeedListing> {
  let listing = feedListingCache.get(feed.url);
  if (!listing) {
    listing = await fetchFeedEntries(feed);
    feedListingCache.set(feed.url, listing);
  }
  return listing;
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

/** The creators to walk, most important first. rankCreators puts the ones
 *  holding priority ahead of the ones we walk because readers visited them;
 *  see creatorRanking.ts. The feed type is derived from the URL rather than
 *  stored, so a row can never disagree with itself. */
async function feedsToWalk(): Promise<{ feed: PriorityFeed; creator: RankedCreator }[]> {
  return (await rankCreators()).map((c) => ({
    feed: { project: c.project_slug, type: canonicalFeed(c.feed_url)?.feed_type ?? "substack", url: c.feed_url },
    creator: c,
  }));
}

/** An unprocessed entry together with the feed it came from, ready for the
 *  cross-feed ranking. `publishedAt` is an ISO date. A missing date sorts
 *  newest, the same way the queue treats an item with no published date. */
interface Candidate {
  feed: PriorityFeed;
  priority: number;
  /** The feed's position in the walk order. This is the author-priority rank
   *  input: the creator ranking puts the most-visited creators first. */
  feedIndex: number;
  /** A creator holding priority has their posts ranked strictly above the
   *  blended ranking, right below individually requested pages. */
  prioritized: boolean;
  entry: UnprocessedEntry;
  sourceName?: string;
  publishedAt?: string;
  topPopularity?: number;
}

/** The rank inputs: where the candidate's feed sits in the walk order, when
 *  the post was published, and the popularity count when the candidate is an
 *  all-time top post rather than a recent one. */
interface Rankable {
  feedIndex: number;
  publishedAt?: string;
  topPopularity?: number;
}

const recencyKey = (c: Rankable) => c.publishedAt ?? "9999";
const isTopPost = (c: Rankable) => c.topPopularity !== undefined;

/** Within one feed's slice of the author rank: recent posts come before the
 *  feed's all-time top posts. Recent posts order by recency, top posts by
 *  their popularity count. */
function withinFeedOrder(a: Rankable, b: Rankable): number {
  if (isTopPost(a) !== isTopPost(b)) return Number(isTopPost(a)) - Number(isTopPost(b));
  if (isTopPost(a) && isTopPost(b)) return b.topPopularity! - a.topPopularity!;
  return recencyKey(b).localeCompare(recencyKey(a));
}

/** Orders the candidates of all feeds by the average of two ranks: a recency
 *  rank (newest post first) and an author rank (the feed walk order, ordered
 *  within a feed by withinFeedOrder). A top author's older post and a lower
 *  author's brand-new post take turns this way, instead of one kind starving
 *  the other. An all-time top post carries its real old publish date, so the
 *  recency rank keeps it low: it only wins on a day when the feeds are
 *  otherwise caught up. Ties in the average go to the more recent post. */
export function rankCandidates<T extends Rankable>(candidates: T[]): T[] {
  const byRecency = [...candidates].sort((a, b) => recencyKey(b).localeCompare(recencyKey(a)));
  const byAuthor = [...candidates].sort((a, b) => a.feedIndex - b.feedIndex || withinFeedOrder(a, b));
  const score = (c: T) => byRecency.indexOf(c) + byAuthor.indexOf(c);
  return [...candidates].sort((a, b) => score(a) - score(b) || byRecency.indexOf(a) - byRecency.indexOf(b));
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

/** Upload dates fetched this process, keyed by video id. A channel listing
 *  carries no upload dates, so a YouTube candidate's date costs one metadata
 *  call. The cycles of one auto-run reuse the answer. */
const uploadDateCache = new Map<string, string | undefined>();

function videoUploadDate(entry: UnprocessedEntry): string | undefined {
  if (!uploadDateCache.has(entry.matchKey)) {
    try {
      uploadDateCache.set(entry.matchKey, fetchVideoMeta(entry.url).uploadDate);
    } catch (err: any) {
      // The ranking can live with an unknown date, so a failed metadata fetch
      // does not kill the run. The date stays unknown and sorts newest, and if
      // the video is genuinely unreachable the worker's own fetch will surface
      // that as an item error.
      console.warn(`Upload date fetch failed for ${entry.url}: ${err?.message}`);
      uploadDateCache.set(entry.matchKey, undefined);
    }
  }
  return uploadDateCache.get(entry.matchKey);
}

/** How much of a creator's priority window is left, for the walk table. Rounded
 *  down to whole days, because the exact hour is not worth a column. */
function priorityLeft(priorityUntil: string | null): string {
  if (!priorityUntil) return "0d";
  const days = Math.floor((Date.parse(priorityUntil) - Date.now()) / (24 * 3600_000));
  return days >= 1 ? `${days}d` : "<1d";
}

/** Runs one pass of triage, selection, and enqueueing. Returns how many items
 *  were enqueued. */
export async function runAutoEnqueue(dryRun = false): Promise<number> {
  if (!dryRun) {
    await triageOrphanedItems();
    await retryErroredItems();
  }

  // A dry run must not write, so it reads the cached top lists without
  // refreshing the stalest one.
  const topRows = dryRun ? await fetchAllTopPosts() : await loadTopPosts();

  const candidates: Candidate[] = [];
  const walked = await feedsToWalk();
  const creatorRows: string[][] = [];
  const skipped: string[] = [];
  const paidByCreator = new Map<string, number>();

  for (const [feedIndex, { feed, creator }] of walked.entries()) {
    let listing;
    try {
      listing = await cachedFeedEntries(feed);
    } catch (err: any) {
      // One creator whose feed will not load must not take the run down with
      // it. Readers can prioritise anyone, so an unreachable feed is ordinary
      // rather than exceptional. Nothing is recorded: a creator holding
      // priority drops out when their seven days lapse, and one walked on
      // visits drops out when those age out of the fourteen-day window, so a
      // dead feed costs one failed request per cycle for at most two weeks.
      skipped.push(`  could not list ${feed.project}: ${err?.message ?? "unknown error"}`);
      continue;
    }
    const { sourceName, entries, paidPosts } = listing;
    if (paidPosts > 0) paidByCreator.set(feed.project, paidPosts);
    const latest = entries.slice(0, FEED_CANDIDATE_LIMIT);
    const tops = topPostEntries(topRows.filter((t) => t.feed_url === feed.url), latest);
    const unprocessed = await unprocessedEntries(feed, [...latest, ...tops]);

    creatorRows.push([
      String(feedIndex + 1),
      feed.project,
      creator.prioritized ? `priority, ${priorityLeft(creator.priorityUntil)} left` : "visits",
      String(creator.visits),
      String(unprocessed.length),
    ]);

    for (const entry of unprocessed) {
      candidates.push({
        feed,
        priority: creator.priority,
        feedIndex,
        prioritized: creator.prioritized,
        entry,
        sourceName,
        topPopularity: entry.topPopularity,
        // A top YouTube post carries its upload date from the cache, so only a
        // fresh video costs a metadata call here.
        publishedAt:
          entry.source === "youtube" && entry.topPopularity === undefined
            ? videoUploadDate(entry)
            : entry.publishedAt,
      });
    }
  }

  const byPriority = walked.filter((w) => w.creator.prioritized).length;
  console.log(
    `\nCREATORS WALKED · ${walked.length} right now · ${byPriority} by priority, ${walked.length - byPriority} by visits · visits counted over the last ${VISIT_RANKING_WINDOW_DAYS} days`,
  );
  const creatorTable = group(
    `the full list of ${creatorRows.length}`,
    table(["rank", "creator", "why", "visits", "unchecked posts"], creatorRows, ["right", "left", "left", "right", "right"]),
  );
  if (creatorTable) console.log(creatorTable);
  for (const line of skipped) console.log(line);
  if (paidByCreator.size > 0) {
    console.log(`  paid posts we cannot read, waiting for the subscriber inbox: ${tally(paidByCreator)}`);
  }

  // A creator holding priority comes strictly before the blended ranking, so
  // priority means "next", not "sooner". Within each partition the blend
  // applies.
  const ranked = [
    ...rankCandidates(candidates.filter((c) => c.prioritized)),
    ...rankCandidates(candidates.filter((c) => !c.prioritized)),
  ];
  const picks = ranked.slice(0, BATCH_SIZE);

  if (picks.length === 0) {
    console.log("\nQUEUE · nothing to add, every creator we walk is caught up");
    return 0;
  }
  console.log("");
  for (const { feed, entry } of picks) {
    console.log(`  adding: [${feed.project}] ${entry.label}`);
    console.log(`          ${entry.url}`);
    if (ranked.length > picks.length) {
      console.log(`          it beat ${ranked.length - picks.length} other candidate posts`);
    }
  }
  if (dryRun) {
    console.log("Dry run — nothing enqueued");
    return 0;
  }

  // An entry whose item row already exists is promoted to a whole-page check
  // in place, keeping its claims and notes. A Substack promotion carries the
  // RSS body, the same text a fresh enqueue would have carried; a YouTube one
  // carries none and the worker fetches the transcript. Promotions count
  // toward the batch exactly like fresh enqueues, because picks was capped
  // above.
  const rows: EnqueueRow[] = [];
  let promoted = 0;
  for (const { feed, priority, entry, sourceName, publishedAt } of picks) {
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
      await promoteItemToWholePage(entry.existingItem.id, entry.fullText ?? null, priority);
      console.log(`  promoted to a whole-page check: ${entry.url}`);
      promoted++;
      continue;
    }
    rows.push({
      project_id: await resolveProjectId({ slug: feed.project, displayName: sourceName, feedUrl: feed.url }),
      source: entry.source,
      url: entry.url,
      title: entry.title,
      full_text: entry.fullText,
      // The candidate's date also covers YouTube, whose upload date the
      // ranking already fetched. The worker used to fill it in after the
      // fetch; setting it here keeps the queue's own ordering honest from the
      // start.
      published_at: publishedAt,
      priority,
    });
  }
  const inserted = rows.length > 0 ? await enqueueItems(rows) : 0;
  console.log(`Enqueued ${inserted} item(s), promoted ${promoted}`);
  return inserted + promoted;
}

if (import.meta.main) {
  ensureYtDlp();
  runAutoEnqueue(process.argv.includes("--dry-run")).catch((err) => {
    console.error("[autoEnqueue] Fatal error:", err);
    process.exit(1);
  });
}
