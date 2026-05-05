/**
 * Generate Candidates
 *
 * Fetches new tweets from the feed, runs bot pipelines, scores them,
 * and returns candidates (eval >= 0) for submission.
 */

import { fetchEligiblePosts } from "../../api/fetchEligiblePosts";
import { SupabaseLogger } from "../../api/supabaseClient";
import { selectRandomBot, getBotById, getBotProbabilities } from "../../bots/index";
import { processSingleTweet, type ProcessTweetResult } from "./processTweet";
import type { Candidate } from "./submitCandidates";
import { createTweetLog, withTweetLog, formatTweetLogSummary, formatTweetLogFull, formatRunSummary, getLoggedBotId, type TweetLogMap } from "../utils/tweetLog";
import { determineFeedSize, buildPostSelection, type FeedSize } from "./utils/feedSizeStrategy";
import { ageInHours, formatCount, sortByRecencyAndImpressions } from "./utils/tweetSorting";
import type { Post } from "../../api/fetchEligiblePosts";
import PQueue from "p-queue";

const CONCURRENCY_LIMIT = 5;
const BACKLOG_LIMIT = 1000;
const RETRIES_ENABLED = false;

// ---------------------------------------------------------------------------
// Post fetching
// ---------------------------------------------------------------------------

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

  const { feedSize, reason } = supabaseLogger
    ? await determineFeedSize(supabaseLogger)
    : { feedSize: "small" as FeedSize, reason: "no supabase" };
  console.log(`[generate] Feed: ${feedSize} (${reason})`);

  const postSelection = buildPostSelection(feedSize);
  const posts = await fetchEligiblePosts(BACKLOG_LIMIT, skipPostIds, 50, postSelection);

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
  forcedBotId?: string;
}

export async function generateCandidates(
  supabaseLogger: SupabaseLogger | null,
  { maxPosts, onTweetProcessed, forcedBotId }: GenerateCandidatesOptions,
): Promise<Candidate[]> {
  const commit = process.env.GITHUB_SHA;

  const forcedBot = forcedBotId ? getBotById(forcedBotId) : undefined;
  if (forcedBotId && !forcedBot) {
    throw new Error(`Unknown bot id: ${forcedBotId}`);
  }

  if (forcedBot) {
    console.log(`[generate] Bots: forced to ${forcedBot.id}`);
  } else {
    const botProbs = getBotProbabilities();
    const activeBots = botProbs.filter((b) => b.probability > 0);
    console.log(`[generate] Bots: ${activeBots.map((b) => `${b.id} ${b.probability.toFixed(1)}%`).join(", ")}`);
  }

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

  for (const [idx, post] of posts.entries()) {
    queue.add(async () => {
      const selectedBot = forcedBot ?? selectRandomBot();

      const log = createTweetLog();
      log.set("tweet.index", idx + 1);
      log.set("tweet.total", posts.length);

      const tweetResult = await withTweetLog(log, () =>
        processSingleTweet({
          post,
          bot: selectedBot,
          logger: supabaseLogger,
          commitSha: commit,
        })
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
    });
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