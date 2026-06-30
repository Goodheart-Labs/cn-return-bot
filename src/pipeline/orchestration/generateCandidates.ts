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
import { MAX_POSTS_CAP } from "./computeMaxPosts";
import type { Candidate } from "./submitCandidates";
import { createTweetLog, withTweetLog, formatTweetLogSummary, formatTweetLogFull, formatRunSummary, getLoggedBotId, type TweetLogMap } from "../utils/tweetLog";
import { buildPostSelection } from "./utils/feedSizeStrategy";
import { ageInHours, formatCount, sortByRecencyAndImpressions } from "./utils/tweetSorting";
import { runABTests, getBotProbabilities, getForcedPicks, withForcedPicks } from "../ab-testing/abTests";
import { AB_TESTS } from "../ab-testing/abTestsData";
import { withBotConfig, type FeedSize } from "../ab-testing/botConfig";
import { withCostTracker } from "../cost-tracking/costTracker";
import { withWarnings } from "../utils/warnings";
import { withMonitoringContext, type MonitoringContext } from "../misinfo-monitoring/monitoringContext";
import type { Post } from "../../api/fetchEligiblePosts";
import PQueue from "p-queue";

const CONCURRENCY_LIMIT = 5;
const BACKLOG_LIMIT = 1000;
// We screen a large feed cheaply with the note-needed prefilter, then run the
// bot only on what it flags. Walk the feed tiers smallest-first (small is the
// premium/curated subset; each larger tier is a superset) and fill up to
// maxPosts: take new posts from `small`, then top up from `large`, then `xl`,
// then `xxl`, deduping against tiers already taken. Each post is tagged with the
// tier it came from (recorded per-post in ab_test_picks.feed_size). Deeper tiers
// are only fetched when shallower ones don't fill maxPosts.
const FULL_FEED_LADDER: FeedSize[] = ["small", "large", "xl", "xxl"];
const SMALL_ONLY_LADDER: FeedSize[] = ["small"];

// Only broaden past the curated small feed when we estimate we need to process
// a lot of tweets to hit the writing limit. When the estimate is low the small
// feed alone supplies enough fresh, higher-quality posts, so we skip the larger
// tiers entirely. Pinned to 2× the per-run cap so the two move together: we dig
// into the larger/lower-quality tiers only once demand exceeds roughly two full
// runs' worth. The estimate is uncapped (unlike maxPosts), so this exceeds it.
const BROADEN_FEED_ESTIMATE_CAP_MULTIPLE = 2;
const BROADEN_FEED_ESTIMATE_THRESHOLD = BROADEN_FEED_ESTIMATE_CAP_MULTIPLE * MAX_POSTS_CAP;

function selectFeedLadder(estimate: number): FeedSize[] {
  return estimate >= BROADEN_FEED_ESTIMATE_THRESHOLD ? FULL_FEED_LADDER : SMALL_ONLY_LADDER;
}

/** A post plus the feed tier it was sourced from (recorded as its feed_size pick). */
interface SourcedPost {
  post: Post;
  feedSize: FeedSize;
}

// ---------------------------------------------------------------------------
// Post fetching
// ---------------------------------------------------------------------------

async function fetchPosts(
  supabaseLogger: SupabaseLogger | null,
  maxPosts: number,
  estimate: number,
  prefetchedSkipPostIds?: Set<string>,
  prefetchedKnownTweetIds?: Set<string>,
): Promise<{ posts: SourcedPost[] }> {
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

  // Walk the ladder smallest-first, accumulating new posts until we hit maxPosts.
  // A tweet is "new" iff it wasn't already in the tweets table. We dedupe against
  // tiers already taken (larger tiers are supersets). Insert every new post we
  // see (insert-only, so engagement on existing rows stays frozen) so subsequent
  // runs treat them as known and we stop re-processing the backlog. A tier that
  // errors (larger feeds sometimes 403) is skipped, not fatal.
  const selected: SourcedPost[] = [];
  const takenIds = new Set<string>();
  const allNew: Post[] = [];

  const feedLadder = selectFeedLadder(estimate);
  console.log(`[generate] estimate=${estimate} → feed ladder [${feedLadder.join(", ")}]`);
  for (const feedSize of feedLadder) {
    if (selected.length >= maxPosts) break;
    let posts: Post[];
    try {
      posts = await fetchEligiblePosts(BACKLOG_LIMIT, skipPostIds, 50, buildPostSelection(feedSize));
    } catch (err) {
      console.warn(`[generate] Feed ${feedSize} failed (${(err as Error)?.message}); skipping tier`);
      continue;
    }
    const newPosts = sortByRecencyAndImpressions(
      posts.filter((p) => !knownTweetIds!.has(p.id) && !takenIds.has(p.id)),
    );
    console.log(`[generate] Feed ${feedSize}: ${posts.length} posts, ${newPosts.length} new`);
    for (const post of newPosts) {
      takenIds.add(post.id);
      allNew.push(post);
      if (selected.length < maxPosts) selected.push({ post, feedSize });
    }
  }

  if (supabaseLogger && allNew.length) {
    try {
      await supabaseLogger.bulkInsertNewTweets(allNew);
      console.log(`[generate] Inserted ${allNew.length} new tweets`);
    } catch (err) {
      console.warn("[generate] Failed to bulk-insert tweets:", err);
    }
  }

  const bySize: Partial<Record<FeedSize, number>> = {};
  for (const s of selected) bySize[s.feedSize] = (bySize[s.feedSize] ?? 0) + 1;
  console.log(`[generate] Processing ${selected.length} tweets: ${JSON.stringify(bySize)}`);
  for (const [i, s] of selected.entries()) {
    const imp = s.post.public_metrics?.impression_count ?? 0;
    const age = ageInHours(s.post);
    console.log(`[generate]   #${i + 1}: ${s.post.id} | ${s.feedSize} | ${formatCount(imp)} imp | ${age.toFixed(1)}h ago`);
  }

  return { posts: selected };
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
    // Misinfo pre-pass posts carry a MonitoringContext — record that they came
    // from monitoring and which topic; regular posts sample the default no/none.
    const monitoringPicks: Record<string, string> = item.monitoring
      ? { misinfo_monitoring: "yes", misinfo_topic: item.monitoring.topicId }
      : {};
    const feedSizePick = { ...outerForcedPicks, feed_size: item.feedSize ?? feedSize, ...monitoringPicks };
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
        withWarnings(() =>
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
  /** Uncapped estimate of posts needed to hit the writing limit; selects feed
   *  breadth (full ladder when high, small-only otherwise). */
  estimate: number;
  /** Pre-fetched by runPipeline and shared with the misinfo pre-pass to avoid
   *  double-scanning notes/pipeline_runs/tweets. Omitted callers fetch them. */
  skipPostIds?: Set<string>;
  knownTweetIds?: Set<string>;
  onTweetProcessed?: (event: TweetProcessedEvent) => void | Promise<void>;
}

export async function generateCandidates(
  supabaseLogger: SupabaseLogger | null,
  { maxPosts, estimate, skipPostIds, knownTweetIds, onTweetProcessed }: GenerateCandidatesOptions,
): Promise<Candidate[]> {
  const outerForcedPicks = getForcedPicks();
  if (Object.keys(outerForcedPicks).length > 0) {
    console.log(`[generate] Forced picks: ${JSON.stringify(outerForcedPicks)}`);
  }
  const botProbs = getBotProbabilities();
  const activeBots = botProbs.filter((b) => b.probability > 0);
  console.log(`[generate] Bots: ${activeBots.map((b) => `${b.id} ${b.probability.toFixed(1)}%`).join(", ")}`);

  const { posts } = await fetchPosts(supabaseLogger, maxPosts, estimate, skipPostIds, knownTweetIds);
  if (!posts.length) {
    console.log("[generate] No eligible posts found.");
    return [];
  }
  logMediaBreakdown(posts.map((s) => s.post));

  // Run-level label for the summary only; per-post feed_size is set on each item.
  // posts are ladder-ordered, so the last one is the deepest tier reached.
  const runFeedSize = posts[posts.length - 1]!.feedSize;
  return processPosts(
    posts.map((s) => ({ post: s.post, feedSize: s.feedSize })),
    supabaseLogger,
    { feedSize: runFeedSize, onTweetProcessed, label: "generate" },
  );
}