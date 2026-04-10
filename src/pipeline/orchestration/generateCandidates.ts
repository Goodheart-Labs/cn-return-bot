/**
 * Generate Candidates
 *
 * Fetches new tweets from the feed, runs bot pipelines, scores them,
 * and returns candidates (eval >= 0) for submission.
 */

import { fetchEligiblePosts } from "../../api/fetchEligiblePosts";
import { SupabaseLogger } from "../../api/supabaseClient";
import { selectRandomBot, getBotProbabilities } from "../../bots/index";
import { processSingleTweet } from "./processTweet";
import type { Candidate } from "./submitCandidates";
import { createTweetLog, withTweetLog, formatTweetLogFull, formatRunSummary, type TweetLogMap } from "../utils/tweetLog";
import { determineFeedSize, buildPostSelection, type FeedSize } from "./utils/feedSizeStrategy";
import { ageInHours, formatCount } from "./utils/tweetSorting";
import type { Post } from "../../api/fetchEligiblePosts";
import PQueue from "p-queue";

let MAX_POSTS = 20;
const CONCURRENCY_LIMIT = 5;
const BACKLOG_LIMIT = 1000;
const DEFAULT_WRITING_LIMIT = 5;

// ---------------------------------------------------------------------------
// Post fetching
// ---------------------------------------------------------------------------

async function fetchPosts(
  supabaseLogger: SupabaseLogger | null
): Promise<{ posts: Post[]; feedSize: FeedSize; newCount: number; retryCount: number }> {
  let skipPostIds = new Set<string>();
  let allProcessedIds = new Set<string>();

  if (supabaseLogger) {
    try {
      [skipPostIds, allProcessedIds] = await Promise.all([
        supabaseLogger.getSkipTweetIds(),
        supabaseLogger.getAllProcessedTweetIds(),
      ]);
      console.log(`[generate] Skip: ${skipPostIds.size} cooldown, ${allProcessedIds.size} total processed`);
    } catch (err) {
      console.warn("[generate] Failed to get processed tweet IDs:", err);
    }
  }

  const { feedSize, reason } = supabaseLogger
    ? await determineFeedSize(supabaseLogger)
    : { feedSize: "small" as FeedSize, reason: "no supabase" };
  console.log(`[generate] Feed: ${feedSize} (${reason})`);

  const postSelection = buildPostSelection(feedSize);
  const posts = await fetchEligiblePosts(BACKLOG_LIMIT, skipPostIds, 50, postSelection);

  const newPosts = posts.filter((p) => !allProcessedIds.has(p.id));
  const retryPosts = posts.filter((p) => allProcessedIds.has(p.id));

  // Calculate retry budget: fill remaining writing capacity with retries
  let retrySlots = 0;
  if (supabaseLogger && retryPosts.length > 0) {
    try {
      const [writingLimitStr, recentSubmissions] = await Promise.all([
        supabaseLogger.getPipelineState("writing_limit"),
        supabaseLogger.countRecentSubmissions(24),
      ]);
      const writingLimit = writingLimitStr ? parseInt(writingLimitStr, 10) : DEFAULT_WRITING_LIMIT;
      const remainingCapacity = Math.max(0, writingLimit - recentSubmissions);
      retrySlots = Math.max(0, remainingCapacity - newPosts.length);
      console.log(`[generate] Writing limit: ${writingLimit}, recent: ${recentSubmissions}, remaining capacity: ${remainingCapacity}, retry slots: ${retrySlots}`);
    } catch (err) {
      console.warn("[generate] Failed to calculate retry budget:", err);
    }
  }

  const selectedNew = newPosts.slice(0, MAX_POSTS);
  const selectedRetry = retryPosts.slice(0, Math.min(retrySlots, MAX_POSTS - selectedNew.length));
  const selected = [...selectedNew, ...selectedRetry];

  console.log(`[generate] Processing ${selectedNew.length} new + ${selectedRetry.length} retry = ${selected.length} tweets`);

  for (const [i, p] of selected.entries()) {
    const imp = p.public_metrics?.impression_count ?? 0;
    const age = ageInHours(p);
    const tag = allProcessedIds.has(p.id) ? " [retry]" : "";
    console.log(`[generate]   #${i + 1}: ${p.id} | ${formatCount(imp)} imp | ${age.toFixed(1)}h ago${tag}`);
  }

  if (supabaseLogger) {
    try {
      await supabaseLogger.logRunSnapshot({
        backlog_total: posts.length,
        backlog_new: newPosts.length,
        backlog_retry: selectedRetry.length,
        backlog_hit_limit: posts.length >= BACKLOG_LIMIT,
        posts_processed: selected.length,
        commit_sha: process.env.GITHUB_SHA,
        feed_size: feedSize,
      });
    } catch (err) {
      console.warn("[generate] Failed to log run snapshot:", err);
    }
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

export async function generateCandidates(supabaseLogger: SupabaseLogger | null, options?: { maxPosts?: number }): Promise<Candidate[]> {
  if (options?.maxPosts) MAX_POSTS = options.maxPosts;
  const commit = process.env.GITHUB_SHA;

  // Log bot probabilities (compact single line)
  const botProbs = getBotProbabilities();
  const activeBots = botProbs.filter((b) => b.probability > 0);
  console.log(`[generate] Bots: ${activeBots.map((b) => `${b.id} ${b.probability.toFixed(1)}%`).join(", ")}`);

  // Fetch posts
  const { posts, feedSize, newCount, retryCount } = await fetchPosts(supabaseLogger);
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
      const selectedBot = selectRandomBot();

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

      console.log(formatTweetLogFull(log));
      allLogs.push(log);

      if (tweetResult.outcome === "candidate" && tweetResult.pipelineRunId) {
        candidates.push({ post, tweetResult, botId: selectedBot.id });
      }
    });
  }

  await queue.onIdle();

  console.log(`[generate] ${candidates.length} candidates (${newCount} new + ${retryCount} retry processed), ${posts.length - candidates.length} rejected`);
  console.log(formatRunSummary(allLogs, feedSize));

  return candidates;
}

// ---------------------------------------------------------------------------
// Commented-out code (candidate storage, previously used for queue)
// ---------------------------------------------------------------------------

/*
async function storeCandidateResult(
  supabaseLogger: SupabaseLogger,
  pipelineRunId: string,
  post: Post,
  botId: string,
  noteText: string,
  pipelineResult: any,
  warningText?: string
): Promise<void> {
  // Expire old candidates for this tweet
  try {
    const existing = await supabaseLogger.fetchAllRows<{ id: string }>(
      (client) => client.from("pipeline_runs").select("id")
        .eq("tweet_id", post.id)
        .eq("outcome", "candidate")
        .neq("id", pipelineRunId)
    );
    for (const old of existing) {
      await supabaseLogger.markCandidateExpired(old.id, "rerolled");
      console.log(`[generate] Expired old candidate ${old.id.slice(0, 8)} for tweet ${post.id} (re-roll)`);
    }
  } catch (err) {
    console.warn(`[generate] Failed to expire old candidates:`, err);
  }

  // Store as candidate
  try {
    await supabaseLogger.completePipelineRun(pipelineRunId, {
      outcome: "candidate",
      outcome_reason: undefined,
      error_message: warningText,
      final_stage: "candidate",
      bot_id: botId,
      note_text: noteText,
      source_url: pipelineResult.noteResult?.url,
      note_status: pipelineResult.noteResult?.status,
      search_results: pipelineResult.searchContextResult?.searchResults?.slice(0, 10000),
      check_reasoning: pipelineResult.checkResult,
    });
  } catch (err) {
    console.warn(`[generate] Failed to store candidate:`, err);
  }
}
*/
