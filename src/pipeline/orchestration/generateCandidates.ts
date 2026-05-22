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
import type { Post } from "../../api/fetchEligiblePosts";
import PQueue from "p-queue";

const CONCURRENCY_LIMIT = 5;
const BACKLOG_LIMIT = 1000;
const RETRIES_ENABLED = false;
// Flip to "large" (or "xl"/"xxl") to use a bigger feed; FALLBACK_FEED_SIZE
// kicks in if the bigger feed 403s. "small" is the safe default.
const PREFERRED_FEED_SIZE: FeedSize = "small";
const FALLBACK_FEED_SIZE: FeedSize = "small";

// ---------------------------------------------------------------------------
// Post fetching
// ---------------------------------------------------------------------------

/**
 * Tries `PREFERRED_FEED_SIZE` first, falls back to `FALLBACK_FEED_SIZE` on any
 * fetch error (the larger feed sometimes returns 403). Returned `feedSize` is
 * the size that actually worked — propagated into ab_test_picks.feed_size so
 * the record matches what the API gave us, not what we asked for.
 */
async function fetchWithFeedSizeFallback(
  skipPostIds: Set<string>
): Promise<{ feedSize: FeedSize; posts: Post[] }> {
  try {
    const posts = await fetchEligiblePosts(BACKLOG_LIMIT, skipPostIds, 50, buildPostSelection(PREFERRED_FEED_SIZE));
    console.log(`[generate] Feed: ${PREFERRED_FEED_SIZE}`);
    return { feedSize: PREFERRED_FEED_SIZE, posts };
  } catch (err) {
    console.warn(`[generate] Feed ${PREFERRED_FEED_SIZE} failed (${(err as Error)?.message}); retrying with ${FALLBACK_FEED_SIZE}`);
    const posts = await fetchEligiblePosts(BACKLOG_LIMIT, skipPostIds, 50, buildPostSelection(FALLBACK_FEED_SIZE));
    console.log(`[generate] Feed: ${FALLBACK_FEED_SIZE} (fallback)`);
    return { feedSize: FALLBACK_FEED_SIZE, posts };
  }
}

async function fetchPosts(
  supabaseLogger: SupabaseLogger | null,
  maxPosts: number
): Promise<{ posts: Post[]; feedSize: FeedSize; newCount: number; retryCount: number }> {
  let skipPostIds = new Set<string>();
  let knownTweetIds = new Set<string>();

  if (supabaseLogger) {
    try {
      [skipPostIds, knownTweetIds] = await Promise.all([
        supabaseLogger.getSkipTweetIds(),
        supabaseLogger.getKnownTweetIds(),
      ]);
      console.log(`[generate] Skip: ${skipPostIds.size} cooldown, ${knownTweetIds.size} already in tweets table`);
    } catch (err) {
      console.warn("[generate] Failed to get known tweet IDs:", err);
    }
  }

  const { feedSize, posts } = await fetchWithFeedSizeFallback(skipPostIds);

  // A tweet is "new" iff it wasn't already in the tweets table before this
  // fetch. Insert the new ones now so subsequent runs see them as known and
  // we stop re-processing the same backlog. Insert-only (not upsert) so
  // engagement metrics on existing rows stay frozen at first sight.
  const newPosts = posts.filter((p) => !knownTweetIds.has(p.id));
  const retryPosts = posts.filter((p) => knownTweetIds.has(p.id));

  if (supabaseLogger && newPosts.length) {
    try {
      await supabaseLogger.bulkInsertNewTweets(newPosts);
      console.log(`[generate] Inserted ${newPosts.length} new tweets`);
    } catch (err) {
      console.warn("[generate] Failed to bulk-insert tweets:", err);
    }
  }

  // Fill remaining slots with retries (submission step handles the daily cap)
  const retrySlots = RETRIES_ENABLED ? Math.max(0, maxPosts - newPosts.length) : 0;

  const sortedNew = sortByRecencyAndImpressions(newPosts);
  const sortedRetry = sortByRecencyAndImpressions(retryPosts);
  const selectedNew = sortedNew.slice(0, maxPosts);
  const selectedRetry = sortedRetry.slice(0, Math.min(retrySlots, maxPosts - selectedNew.length));
  const selected = [...selectedNew, ...selectedRetry];

  console.log(`[generate] Processing ${selectedNew.length} new + ${selectedRetry.length} retry = ${selected.length} tweets`);

  for (const [i, p] of selected.entries()) {
    const imp = p.public_metrics?.impression_count ?? 0;
    const age = ageInHours(p);
    const tag = knownTweetIds.has(p.id) ? " [retry]" : "";
    console.log(`[generate]   #${i + 1}: ${p.id} | ${formatCount(imp)} imp | ${age.toFixed(1)}h ago${tag}`);
  }

  return { posts: selected, feedSize, newCount: selectedNew.length, retryCount: selectedRetry.length };
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

export interface GenerateCandidatesOptions {
  maxPosts: number;
  onTweetProcessed?: (event: TweetProcessedEvent) => void | Promise<void>;
}

export async function generateCandidates(
  supabaseLogger: SupabaseLogger | null,
  { maxPosts, onTweetProcessed }: GenerateCandidatesOptions,
): Promise<Candidate[]> {
  const commit = process.env.GITHUB_SHA;

  const outerForcedPicks = getForcedPicks();
  if (Object.keys(outerForcedPicks).length > 0) {
    console.log(`[generate] Forced picks: ${JSON.stringify(outerForcedPicks)}`);
  }
  const botProbs = getBotProbabilities();
  const activeBots = botProbs.filter((b) => b.probability > 0);
  console.log(`[generate] Bots: ${activeBots.map((b) => `${b.id} ${b.probability.toFixed(1)}%`).join(", ")}`);

  // Fetch posts
  const { posts, feedSize, newCount, retryCount } = await fetchPosts(supabaseLogger, maxPosts);
  if (!posts.length) {
    console.log("[generate] No eligible posts found.");
    return [];
  }
  logMediaBreakdown(posts);

  // Process posts concurrently
  const queue = new PQueue({ concurrency: CONCURRENCY_LIMIT });
  const allLogs: TweetLogMap[] = [];
  const candidates: Candidate[] = [];

  // Force feed_size pick to the size the fetch actually used (preferred
  // normally, fallback after API failure) so the recorded pick matches reality.
  const feedSizePick = { ...outerForcedPicks, feed_size: feedSize };

  for (const [idx, post] of posts.entries()) {
    queue.add(() => withForcedPicks(feedSizePick, async () => {
      // Forced picks (if any) are already in ALS — set up by runPipeline.ts
      // via withForcedPicks. runABTests honours them for whichever tests fire.
      const { config, picks } = runABTests(AB_TESTS);
      const selectedBot = getBotById(config.botId);
      if (!selectedBot) {
        throw new Error(`No bot registered for id "${config.botId}" picked by AB_TESTS`);
      }

      const log = createTweetLog();
      log.set("tweet.index", idx + 1);
      log.set("tweet.total", posts.length);

      const tweetResult = await withTweetLog(log, () =>
        withBotConfig(config, () =>
          withCostTracker(() => {
            log.set("bot.id", config.botId);
            log.set("bot.picks", picks);
            log.set("bot.config", config);
            return processSingleTweet({
              post,
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
        try { await onTweetProcessed({ post, tweetResult, log, botId }); }
        catch (err) { console.warn("[generate] onTweetProcessed hook failed:", err); }
      }

      if (tweetResult.outcome === "candidate" && tweetResult.pipelineRunId) {
        candidates.push({ post, tweetResult, botId });
      }
    }));
  }

  await queue.onIdle();

  if (process.env.CI) {
    console.log("::endgroup::");
    console.log("::group::Run summary");
  }
  console.log(`[generate] ${candidates.length} candidates (${newCount} new + ${retryCount} retry processed), ${posts.length - candidates.length} rejected`);
  console.log(formatRunSummary(allLogs, feedSize));
  if (process.env.CI) console.log("::endgroup::");

  return candidates;
}