/**
 * Generate Candidates
 *
 * Fetches new tweets from the feed, runs bot pipelines, scores them,
 * and returns candidates (eval >= 0) for submission.
 */

import { fetchEligiblePosts } from "../../api/fetchEligiblePosts";
import { SupabaseLogger } from "../../api/supabaseClient";
import { getBotById } from "../../bots/index";
import { processSingleTweet, type ProcessTweetResult } from "./processTweet";
import type { Candidate } from "./submitCandidates";
import { createTweetLog, withTweetLog, formatTweetLogSummary, formatTweetLogFull, formatRunSummary, getLoggedBotId, type TweetLogMap } from "../utils/tweetLog";
import { buildPostSelection } from "./utils/feedSizeStrategy";
import { ageInHours, formatCount, sortByRecencyAndImpressions } from "./utils/tweetSorting";
import { runABTests, getBotProbabilities, getForcedPicks, withForcedPicks } from "../ab-testing/abTests";
import { AB_TESTS } from "../ab-testing/abTestsData";
import { withBotConfig, type FeedSize } from "../ab-testing/botConfig";
import { withCostTracker } from "../cost-tracking/costTracker";
import { withMonitoringContext, type MonitoringContext } from "../misinfo-monitoring/monitoringContext";
import type { Post } from "../../api/fetchEligiblePosts";
import PQueue from "p-queue";

const CONCURRENCY_LIMIT = 5;
const BACKLOG_LIMIT = 1000;
// We screen a LARGE feed cheaply with the note-needed prefilter, then run the
// bot only on what it flags. The small feed is the premium/curated subset, so
// we take its new posts FIRST, then top up from the large feed — each post is
// tagged with the feed it came from (recorded per-post in ab_test_picks.feed_size).
const SMALL_FEED_SIZE: FeedSize = "small";
const LARGE_FEED_SIZE: FeedSize = "large";

/** A post plus the feed it was sourced from (recorded as its feed_size pick). */
interface SourcedPost {
  post: Post;
  feedSize: FeedSize;
}

// ---------------------------------------------------------------------------
// Post fetching
// ---------------------------------------------------------------------------

/**
 * Fetch the small feed first, then the large feed. Falls back to small-only if
 * the large feed errors (it sometimes 403s). Both fetches share `skipPostIds`.
 */
async function fetchSmallThenLarge(
  skipPostIds: Set<string>,
): Promise<{ small: Post[]; large: Post[] }> {
  const small = await fetchEligiblePosts(BACKLOG_LIMIT, skipPostIds, 50, buildPostSelection(SMALL_FEED_SIZE));
  let large: Post[] = [];
  try {
    large = await fetchEligiblePosts(BACKLOG_LIMIT, skipPostIds, 50, buildPostSelection(LARGE_FEED_SIZE));
  } catch (err) {
    console.warn(`[generate] Large feed failed (${(err as Error)?.message}); using small only`);
  }
  console.log(`[generate] Feed: small=${small.length}, large=${large.length}`);
  return { small, large };
}

async function fetchPosts(
  supabaseLogger: SupabaseLogger | null,
  maxPosts: number,
  prefetchedSkipPostIds?: Set<string>,
  prefetchedKnownTweetIds?: Set<string>,
): Promise<{ posts: SourcedPost[]; smallCount: number; largeCount: number }> {
  let skipPostIds = prefetchedSkipPostIds;
  let knownTweetIds = prefetchedKnownTweetIds;

  // Fetch whatever the caller didn't pre-fetch. runPipeline pre-fetches both
  // (shared with the misinfo pre-pass) so notes/pipeline_runs aren't scanned
  // twice per run; other callers fetch here.
  if (supabaseLogger && (!skipPostIds || !knownTweetIds)) {
    try {
      const [skip, known] = await Promise.all([
        supabaseLogger.getSkipTweetIds(),
        supabaseLogger.getKnownTweetIds(),
      ]);
      skipPostIds = skipPostIds ?? skip;
      knownTweetIds = knownTweetIds ?? known;
    } catch (err) {
      console.warn("[generate] Failed to get known tweet IDs:", err);
    }
  }
  skipPostIds = skipPostIds ?? new Set<string>();
  knownTweetIds = knownTweetIds ?? new Set<string>();
  console.log(`[generate] Skip: ${skipPostIds.size} cooldown, ${knownTweetIds.size} already in tweets table`);

  const { small, large } = await fetchSmallThenLarge(skipPostIds);

  // A tweet is "new" iff it wasn't already in the tweets table before this
  // fetch. Take new posts from the small feed first, then top up with new posts
  // from the large feed that the small feed didn't already include. Insert the
  // new ones now (insert-only, so engagement on existing rows stays frozen) so
  // subsequent runs see them as known and we stop re-processing the backlog.
  const smallIds = new Set(small.map((p) => p.id));
  const newSmall = sortByRecencyAndImpressions(small.filter((p) => !knownTweetIds!.has(p.id)));
  const newLarge = sortByRecencyAndImpressions(
    large.filter((p) => !knownTweetIds!.has(p.id) && !smallIds.has(p.id)),
  );

  const allNew = [...newSmall, ...newLarge];
  if (supabaseLogger && allNew.length) {
    try {
      await supabaseLogger.bulkInsertNewTweets(allNew);
      console.log(`[generate] Inserted ${allNew.length} new tweets`);
    } catch (err) {
      console.warn("[generate] Failed to bulk-insert tweets:", err);
    }
  }

  // Small first, then large fill, capped at maxPosts. Each post keeps its source
  // feed (recorded per-post in ab_test_picks.feed_size). Retries are disabled.
  const sourced: SourcedPost[] = [
    ...newSmall.map((post) => ({ post, feedSize: SMALL_FEED_SIZE })),
    ...newLarge.map((post) => ({ post, feedSize: LARGE_FEED_SIZE })),
  ];
  const selected = sourced.slice(0, maxPosts);
  const smallCount = selected.filter((s) => s.feedSize === SMALL_FEED_SIZE).length;
  const largeCount = selected.length - smallCount;

  console.log(`[generate] Processing ${smallCount} small + ${largeCount} large = ${selected.length} tweets`);
  for (const [i, s] of selected.entries()) {
    const imp = s.post.public_metrics?.impression_count ?? 0;
    const age = ageInHours(s.post);
    console.log(`[generate]   #${i + 1}: ${s.post.id} | ${s.feedSize} | ${formatCount(imp)} imp | ${age.toFixed(1)}h ago`);
  }

  return { posts: selected, smallCount, largeCount };
}

function logMediaBreakdown(posts: Post[]): void {
  const videoCount = posts.filter((p) => p.media?.some((m) => m.type === "video")).length;
  const photoCount = posts.filter(
    (p) => p.media?.some((m) => m.type === "photo") && !p.media?.some((m) => m.type === "video")
  ).length;
  const textOnlyCount = posts.filter((p) => !p.media || p.media.length === 0).length;
  console.log(
    `[generate] Media breakdown: ${videoCount} video, ${photoCount} photo-only, ${textOnlyCount} text-only`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export interface TweetProcessedEvent {
  post: Post;
  tweetResult: ProcessTweetResult;
  log: TweetLogMap;
  botId: string;
}

/**
 * A post to process, optionally with the misinfo-monitoring context that
 * injects a topic's reference document into the bot's research step. Regular
 * small-feed posts carry no monitoring context.
 */
export interface ProcessPostItem {
  post: Post;
  monitoring?: MonitoringContext;
  /** Feed this post came from; recorded as its feed_size pick. Falls back to
   *  the run-level `feedSize` option when unset (e.g. the misinfo pre-pass). */
  feedSize?: FeedSize;
}

export interface ProcessPostsOptions {
  /** feed_size pick recorded on each run; the size the fetch actually used. */
  feedSize: FeedSize;
  onTweetProcessed?: (event: TweetProcessedEvent) => void | Promise<void>;
  /** Log prefix so the misinfo pre-pass and regular pass are distinguishable. */
  label?: string;
}

/**
 * Run the per-post pipeline over `items` concurrently: AB-pick a bot, wrap it
 * in the per-tweet ALS contexts (forced picks, monitoring, tweet log, bot
 * config, cost tracker), process, score, and collect candidates. Shared by the
 * regular small-feed pass and the XXL-feed misinfo pre-pass.
 */
export async function processPosts(
  items: ProcessPostItem[],
  supabaseLogger: SupabaseLogger | null,
  { feedSize, onTweetProcessed, label = "generate" }: ProcessPostsOptions,
): Promise<Candidate[]> {
  if (!items.length) return [];

  const commit = process.env.GITHUB_SHA;
  const outerForcedPicks = getForcedPicks();

  const queue = new PQueue({ concurrency: CONCURRENCY_LIMIT });
  const allLogs: TweetLogMap[] = [];
  const candidates: Candidate[] = [];

  for (const [idx, item] of items.entries()) {
    // Force the feed_size pick to the feed THIS post came from (small vs large
    // fill); falls back to the run-level size for callers that don't tag posts.
    const feedSizePick = { ...outerForcedPicks, feed_size: item.feedSize ?? feedSize };
    queue.add(() => withForcedPicks(feedSizePick, () => withMonitoringContext(item.monitoring, async () => {
      // Forced picks (if any) are already in ALS — set up by runPipeline.ts
      // via withForcedPicks. runABTests honours them for whichever tests fire.
      const { config, picks } = runABTests(AB_TESTS);
      const selectedBot = getBotById(config.botId);
      if (!selectedBot) {
        throw new Error(`No bot registered for id "${config.botId}" picked by AB_TESTS`);
      }

      const log = createTweetLog();
      log.set("tweet.index", idx + 1);
      log.set("tweet.total", items.length);

      const tweetResult = await withTweetLog(log, () =>
        withBotConfig(config, () =>
          withCostTracker(() => {
            log.set("bot.id", config.botId);
            log.set("bot.picks", picks);
            log.set("bot.config", config);
            return processSingleTweet({
              post: item.post,
              bot: selectedBot,
              logger: supabaseLogger,
              commitSha: commit,
            });
          }),
        ),
      );

      console.log(`${formatTweetLogSummary(log)}\n${formatTweetLogFull(log)}`);
      allLogs.push(log);

      const botId = getLoggedBotId(selectedBot.id, log);
      if (onTweetProcessed) {
        try { await onTweetProcessed({ post: item.post, tweetResult, log, botId }); }
        catch (err) { console.warn(`[${label}] onTweetProcessed hook failed:`, err); }
      }

      if (tweetResult.outcome === "candidate" && tweetResult.pipelineRunId) {
        candidates.push({ post: item.post, tweetResult, botId });
      }
    })));
  }

  await queue.onIdle();

  if (process.env.CI) {
    console.log("::endgroup::");
    console.log("::group::Run summary");
  }
  console.log(`[${label}] ${candidates.length} candidates, ${items.length - candidates.length} rejected (of ${items.length} processed)`);
  console.log(formatRunSummary(allLogs, feedSize));
  if (process.env.CI) console.log("::endgroup::");

  return candidates;
}

export interface GenerateCandidatesOptions {
  maxPosts: number;
  /** Pre-fetched by runPipeline and shared with the misinfo pre-pass to avoid
   *  double-scanning notes/pipeline_runs/tweets. Omitted callers fetch them. */
  skipPostIds?: Set<string>;
  knownTweetIds?: Set<string>;
  onTweetProcessed?: (event: TweetProcessedEvent) => void | Promise<void>;
}

export async function generateCandidates(
  supabaseLogger: SupabaseLogger | null,
  { maxPosts, skipPostIds, knownTweetIds, onTweetProcessed }: GenerateCandidatesOptions,
): Promise<Candidate[]> {
  const outerForcedPicks = getForcedPicks();
  if (Object.keys(outerForcedPicks).length > 0) {
    console.log(`[generate] Forced picks: ${JSON.stringify(outerForcedPicks)}`);
  }
  const botProbs = getBotProbabilities();
  const activeBots = botProbs.filter((b) => b.probability > 0);
  console.log(`[generate] Bots: ${activeBots.map((b) => `${b.id} ${b.probability.toFixed(1)}%`).join(", ")}`);

  const { posts } = await fetchPosts(supabaseLogger, maxPosts, skipPostIds, knownTweetIds);
  if (!posts.length) {
    console.log("[generate] No eligible posts found.");
    return [];
  }
  logMediaBreakdown(posts.map((s) => s.post));

  return processPosts(
    posts.map((s) => ({ post: s.post, feedSize: s.feedSize })),
    supabaseLogger,
    { feedSize: LARGE_FEED_SIZE, onTweetProcessed, label: "generate" },
  );
}