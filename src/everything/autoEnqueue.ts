/**
 * Auto-enqueue the next unprocessed content of the feeds we keep fact-checked.
 * The walk order comes from the creator ranking: creators holding priority
 * first, then everyone by reader attention (see creatorRanking.ts). The
 * everything-priority-feeds workflow runs this at the start of every feed run
 * when nothing is waiting in the feed tiers of the queue.
 *
 * Which creators are walked is decided by the budget (admitCreators): the
 * ranked list is walked from the top until the creators' publishing rates add
 * up to the posts a day the paced budget affords, and nobody below that line
 * is listed. Creators holding priority are always walked and counted first.
 *
 * For every walked feed we fetch its latest entries, newest first. A Substack feed
 * comes from its RSS feed, which goes through our Cloudflare Worker when we run
 * in CI. A YouTube feed comes from the channel's /videos tab. Only a feed's
 * newest few entries are candidates, and we drop every candidate that already
 * has a whole-page everything_items row. Any status counts as processed there,
 * including an item that finished with zero notes; an errored item is handled
 * by the retry sweep instead. The remaining candidates from all feeds are
 * ranked together, by a weighted blend of an author-priority rank and a
 * recency rank, and the best ones are enqueued. The author rank carries most
 * of the weight, so the creators readers care about most are served first and
 * a creator who uploads several times a day cannot crowd them out with sheer
 * volume. The recency share keeps a fresh post from a lower creator ahead of
 * a slightly higher creator's stale backlog, and the candidate window bounds
 * how deep any backlog can reach. A gap deeper than the candidate window is
 * left unfilled on purpose.
 *
 * Each creator's all-time top posts join the candidates too (GOO-81, see
 * topPosts.ts). In the author rank they line up behind the creator's recent
 * posts, ordered by popularity, and in the recency rank they carry their real
 * old publish dates. Nothing gates them beyond that. Because the author rank
 * dominates, a top creator's evergreen hits come before the fresh posts of
 * creators far down the walk order, and only behind that creator's own
 * recent posts. A flagged creator's candidates are ranked ahead of everyone
 * else's, so a creator you flagged who has no unchecked new posts contributes
 * their top posts next. That is what flagging is for.
 *
 * A Substack post is enqueued with its RSS body already in full_text. That way
 * the worker never has to fetch Substack, which blocks our CI runners.
 *
 * Usage:
 *   bun run src/everything/autoEnqueue.ts [--dry-run] [--affordable <posts per day>]
 *
 * --affordable answers "what would the walk admit at that budget" without
 * reading the pacing snapshot, which is also how a dry run works before
 * migration 096 exists on the database it points at.
 */

import "dotenv/config";
import { extractYoutubeVideoId } from "../everything-shared/pageUrls";
import { rankCreators, type RankedCreator } from "./creatorRanking";
import { MIN_PAGES_FOR_A_READER, VISIT_RANKING_WINDOW_DAYS } from "../everything-shared/readers";
import { affordablePostsPerDay, computeNextRun, MEAN_COST_RULE } from "./pacing";
import { FEED_BUDGET_USD } from "./spendCap";
import {
  enqueueItems,
  fetchAllTopPosts,
  fetchFeedPacing,
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
import type { FeedType } from "./feedUrls";
import { fixedRow, groupClose, groupOpen, tally } from "./logFormat";
import { fetchAuthorPosts } from "./sources/lesswrong";
import { fetchFeedPosts, fetchPostBodyText, htmlToText } from "./sources/substack";
import { fetchChannelUploads } from "./sources/youtubeDataApi";
import { loadTopPosts } from "./topPosts";
import type { SourceKind } from "./types";

/** How many items one run enqueues, and therefore processes, across all feeds. */
const BATCH_SIZE = 1;
/** How many entries a feed listing fetches: YouTube channel videos and forum
 *  author posts. Substack's RSS feed has its own fixed window of about twenty. */
const FEED_FETCH_LIMIT = 15;
/** Only a feed's newest posts are ever candidates. A newly followed creator
 *  therefore backfills at most this many posts, instead of their whole 15 to
 *  20 entry feed window. Whole-window backfills used to eat the daily spend
 *  cap; one follow brought in archive posts years old while fresh posts from
 *  other feeds waited. A gap deeper than this window stays unfilled on
 *  purpose. */
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
  if (feed.type === "lesswrong") {
    const { authorName, posts } = await fetchAuthorPosts(feed.url, FEED_FETCH_LIMIT);
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
  const { channel, videos } = await fetchChannelUploads(feed.url, FEED_FETCH_LIMIT);
  const entries = videos
    // An upcoming premiere cannot be watched yet, and enqueueing it would
    // leave the item in a permanent error state. A later run picks it up
    // once the video is live.
    .filter((v) => !v.upcoming)
    .map((v) => ({
      source: "youtube" as const,
      url: v.url,
      matchKey: v.videoId,
      label: `${v.publishedAt} ${v.title}`,
      title: v.title,
      publishedAt: v.publishedAt,
    }));
  return { sourceName: channel.title, entries, paidPosts: 0 };
}

/** Feed listings fetched this process, keyed by feed URL. The admission walk
 *  and the top-posts refresh of one run reuse them, so a feed is listed once
 *  per run however many steps look at it. The unprocessed check against the
 *  database still runs on every use, so an entry enqueued earlier in the run
 *  is not picked again. */
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

/** How the two ranks are blended. The author rank carries nine tenths of the
 *  score, so one step down the walk order costs as much as nine steps of
 *  recency. With an even split, creators who upload several times a day took
 *  most of the daily budget because each upload was among the newest
 *  candidates, while the most-read creators waited for days. */
const AUTHOR_RANK_WEIGHT = 0.9;
const RECENCY_RANK_WEIGHT = 0.1;

/** Orders the candidates of all feeds by a weighted blend of two ranks: an
 *  author rank (the feed walk order, ordered within a feed by
 *  withinFeedOrder) and a recency rank (newest post first). Each candidate's
 *  score is its position in each ordering, weighted, and the lowest score is
 *  served first. Ties in the score go to the more recent post. */
export function rankCandidates<T extends Rankable>(candidates: T[]): T[] {
  const byRecency = [...candidates].sort((a, b) => recencyKey(b).localeCompare(recencyKey(a)));
  const byAuthor = [...candidates].sort((a, b) => a.feedIndex - b.feedIndex || withinFeedOrder(a, b));
  const score = (c: T) => AUTHOR_RANK_WEIGHT * byAuthor.indexOf(c) + RECENCY_RANK_WEIGHT * byRecency.indexOf(c);
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

/** How many days of a feed's listing the publishing rate is measured over. */
const PUBLISHING_RATE_WINDOW_DAYS = 14;

const DAY_MS = 24 * 3600_000;

/** A creator's publishing rate in posts per day: the listed entries dated
 *  inside the window, divided by the window's length. Undated entries do not
 *  count. A listing holds about 15 to 20 entries, so a creator who posts more
 *  than that inside the window is undercounted at roughly 1.1 to 1.4 a day.
 *  That is acceptable, because such a creator fills a budget on their own
 *  either way. Exported for the tests. */
export function publishingRatePerDay(entries: { publishedAt?: string }[], now: Date): number {
  const since = new Date(now.getTime() - PUBLISHING_RATE_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  return entries.filter((e) => e.publishedAt !== undefined && e.publishedAt >= since).length / PUBLISHING_RATE_WINDOW_DAYS;
}

/** What admitting one creator produced: at least their publishing rate. */
interface Admitted<C, W> {
  creator: C;
  /** The creator's position in the ranked list, which is the author rank. */
  index: number;
  walk: W;
}

/** How many creators with posts to process one walk collects before it stops
 *  looking further down the ranking. Jim's rule (2026-09-15): a run enqueues
 *  one post, so five creators' worth of candidates is plenty. Without it a
 *  cheap day admitted every ranked creator and the walk took 40 minutes. */
const MAX_CREATORS_WITH_NEW_POSTS = 5;

/** Why the walk stopped where it did, for the log. */
type Cutoff = "budget" | "enough";

/** Decides which of the ranked creators are walked this run. A creator
 *  holding priority is always walked and counted first. Then attention
 *  creators are walked in order until either the cumulative publishing rate
 *  reaches the affordable rate or enough creators with posts to process have
 *  been found; the creator who crosses the budget line is still walked, so
 *  the budget is filled rather than left short, and nobody below the line is
 *  even listed. A creator whose walk returns null could not be listed and is
 *  skipped without counting. Exported for the tests, which inject the walk. */
export async function admitCreators<C extends { prioritized: boolean }, W extends { rate: number; newPosts: number }>(
  ranked: C[],
  affordable: number,
  walk: (creator: C, index: number) => Promise<W | null>,
  maxWithNewPosts = MAX_CREATORS_WITH_NEW_POSTS,
): Promise<{ admitted: Admitted<C, W>[]; cumulativeRate: number; cutoffIndex: number | null; cutoff: Cutoff | null }> {
  const admitted: Admitted<C, W>[] = [];
  let cumulativeRate = 0;
  let withNewPosts = 0;
  for (const [index, creator] of ranked.entries()) {
    if (!creator.prioritized) {
      if (cumulativeRate >= affordable) return { admitted, cumulativeRate, cutoffIndex: index, cutoff: "budget" };
      if (withNewPosts >= maxWithNewPosts) return { admitted, cumulativeRate, cutoffIndex: index, cutoff: "enough" };
    }
    const result = await walk(creator, index);
    if (!result) continue;
    admitted.push({ creator, index, walk: result });
    cumulativeRate += result.rate;
    if (result.newPosts > 0) withNewPosts++;
  }
  return { admitted, cumulativeRate, cutoffIndex: null, cutoff: null };
}

/** Column widths of the walk table, fixed so rows can print as they arrive. */
const CREATOR_COLUMNS = [4, 24, 20, 7, 5, 6, 9, 9, 6];
const CREATOR_ALIGN: ("left" | "right")[] = ["right", "left", "left", "right", "right", "right", "right", "right", "right"];

/** How much of a creator's priority window is left, for the walk table. Rounded
 *  down to whole days, because the exact hour is not worth a column. */
function priorityLeft(priorityUntil: string | null): string {
  if (!priorityUntil) return "0d";
  const days = Math.floor((Date.parse(priorityUntil) - Date.now()) / DAY_MS);
  return days >= 1 ? `${days}d` : "<1d";
}

/** How many posts a day the budget buys at the current mean post cost, from
 *  the same snapshot the pacing rule reads. The command-line entry point uses
 *  this; the feed run passes the number it already computed. */
export async function affordablePostsPerDayNow(): Promise<number> {
  const snapshot = await fetchFeedPacing(MEAN_COST_RULE);
  return affordablePostsPerDay(computeNextRun(snapshot, FEED_BUDGET_USD).meanPostCostUsd, FEED_BUDGET_USD);
}

/** Runs one pass of admission, selection, and enqueueing. `affordable` is how
 *  many posts a day the budget buys; the walk admits creators until their
 *  publishing rates add up to it. Returns how many items were enqueued. */
export async function runAutoEnqueue(affordable: number, dryRun = false): Promise<number> {
  const ranked = await rankCreators();
  // The cached top lists serve this walk. The stalest admitted creator's list
  // is refreshed after the walk, once the admitted set is known, and the fresh
  // rows serve the next cycle.
  const topRows = await fetchAllTopPosts();

  const candidates: Candidate[] = [];
  const skipped: string[] = [];
  const paidByCreator = new Map<string, number>();

  // The header and the group open before the walk, and each creator's row is
  // printed the moment their feed has been listed. The walk can take minutes
  // (each YouTube channel is a yt-dlp call), and a log that said nothing until
  // the end read as a hang.
  const byPriority = ranked.filter((c) => c.prioritized).length;
  console.log(
    `\nCREATORS · ${ranked.length} ranked · ${byPriority} by priority, ${ranked.length - byPriority} by attention · ranked by readers, a browser that opened at least ${MIN_PAGES_FOR_A_READER} different pages · counted over the last ${VISIT_RANKING_WINDOW_DAYS} days`,
  );
  console.log(`  the budget affords ${affordable.toFixed(1)} posts a day · creators are walked from the top until their posts per day add up to that`);
  console.log(groupOpen("the walk, in rank order"));
  console.log(
    fixedRow(
      ["rank", "creator", "why", "readers", "pages", "visits", "unchecked", "posts/day", "cum."],
      CREATOR_COLUMNS,
      CREATOR_ALIGN,
    ),
  );

  let cumulativeSoFar = 0;
  const walkCreator = async (creator: RankedCreator, feedIndex: number): Promise<{ rate: number; newPosts: number } | null> => {
    const feed: PriorityFeed = { project: creator.project_slug, type: creator.feed_type, url: creator.feed_url };
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
      console.log(
        fixedRow([String(feedIndex + 1), feed.project, "could not list", "", "", "", "", "", ""], CREATOR_COLUMNS, CREATOR_ALIGN),
      );
      return null;
    }
    const { sourceName, entries, paidPosts } = listing;
    if (paidPosts > 0) paidByCreator.set(feed.project, paidPosts);
    const rate = publishingRatePerDay(entries, new Date());
    cumulativeSoFar += rate;
    const latest = entries.slice(0, FEED_CANDIDATE_LIMIT);
    const tops = topPostEntries(topRows.filter((t) => t.feed_url === feed.url), latest);
    const unprocessed = await unprocessedEntries(feed, [...latest, ...tops]);

    console.log(
      fixedRow(
        [
          String(feedIndex + 1),
          feed.project,
          creator.prioritized ? `priority, ${priorityLeft(creator.priorityUntil)} left` : "attention",
          String(creator.readers),
          String(creator.pages),
          String(creator.visits),
          String(unprocessed.length),
          rate.toFixed(2),
          cumulativeSoFar.toFixed(1),
        ],
        CREATOR_COLUMNS,
        CREATOR_ALIGN,
      ),
    );

    for (const entry of unprocessed) {
      candidates.push({
        feed,
        priority: creator.priority,
        feedIndex,
        prioritized: creator.prioritized,
        entry,
        sourceName,
        topPopularity: entry.topPopularity,
        publishedAt: entry.publishedAt,
      });
    }
    return { rate, newPosts: unprocessed.length };
  };

  const { admitted, cumulativeRate, cutoffIndex, cutoff } = await admitCreators(ranked, affordable, walkCreator);

  const closing = groupClose();
  if (closing) console.log(closing);
  console.log(
    `  walked ${admitted.length} of ${ranked.length}${skipped.length ? `, ${skipped.length} could not be listed` : ""} · their posts add up to ${cumulativeRate.toFixed(1)} a day against ${affordable.toFixed(1)} affordable`,
  );
  const last = admitted.at(-1);
  if (cutoffIndex !== null && last) {
    const below = ranked.length - cutoffIndex;
        const why =
      cutoff === "enough"
        ? `${MAX_CREATORS_WITH_NEW_POSTS} creators already have posts to process, so the ${below} below the line wait for a later run`
        : `${below} below the line wait for a cheaper day`;
    console.log(`  cutoff: rank ${last.index + 1} ${last.creator.project_slug} (${last.creator.readers} readers, ${last.creator.pages} pages) is the last creator walked · ${why}`);
  } else if (byPriority > 0 && admitted.every((a) => a.creator.prioritized) && byPriority < ranked.length) {
    console.log(`  creators holding priority fill the budget by themselves · nobody is walked on attention today`);
  } else {
    console.log(`  every ranked creator fits in the budget`);
  }
  for (const line of skipped) console.log(line);
  if (paidByCreator.size > 0) {
    console.log(`  paid posts we cannot read, waiting for the subscriber inbox: ${tally(paidByCreator)}`);
  }
  // The weekly top-posts refresh is spent on a creator we actually walk. Its
  // fresh rows are in the table for the next cycle; this one used the cache.
  if (!dryRun) await loadTopPosts(admitted.map((a) => a.creator));

  // A creator holding priority comes strictly before the blended ranking, so
  // priority means "next", not "sooner". Within each partition the blend
  // applies.
  const rankedCandidates = [
    ...rankCandidates(candidates.filter((c) => c.prioritized)),
    ...rankCandidates(candidates.filter((c) => !c.prioritized)),
  ];
  const picks = rankedCandidates.slice(0, BATCH_SIZE);

  if (picks.length === 0) {
    console.log("\nQUEUE · nothing to add, every creator we walk is caught up");
    return 0;
  }
  console.log("");
  for (const { feed, entry } of picks) {
    console.log(`  adding: [${feed.project}] ${entry.label}`);
    console.log(`          ${entry.url}`);
    if (rankedCandidates.length > picks.length) {
      console.log(`          it beat ${rankedCandidates.length - picks.length} other candidate posts`);
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
      // The candidate's date also covers YouTube, whose upload date the walk
      // already fetched. Setting it here keeps the queue's own ordering
      // honest from the start.
      published_at: publishedAt,
      priority,
    });
  }
  const inserted = rows.length > 0 ? await enqueueItems(rows) : 0;
  console.log(`Enqueued ${inserted} item(s), promoted ${promoted}`);
  return inserted + promoted;
}

if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  const affordableArg = process.argv[process.argv.indexOf("--affordable") + 1];
  const affordable = process.argv.includes("--affordable") ? Number(affordableArg) : null;
  if (affordable !== null && !(affordable > 0)) throw new Error("--affordable needs a positive number of posts per day");
  (dryRun ? Promise.resolve() : triageQueue())
    .then(() => affordable ?? affordablePostsPerDayNow())
    .then((posts) => runAutoEnqueue(posts, dryRun))
    .catch((err) => {
    console.error("[autoEnqueue] Fatal error:", err);
    process.exit(1);
  });
}
