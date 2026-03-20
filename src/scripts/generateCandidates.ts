/**
 * Generate Candidates
 *
 * Phase 1 of the two-phase pipeline. Fetches eligible tweets, runs bot
 * pipelines to write notes, scores them, and stores as candidates in
 * pipeline_runs. Does NOT submit — that's submitCandidates.ts.
 */

import { fetchEligiblePosts } from "../api/fetchEligiblePosts";
import { SupabaseLogger } from "../api/supabaseClient";
import { selectRandomBot, getBotProbabilities } from "../bots";
import { processSingleTweet } from "../pipeline/processTweet";
import { createTweetLog, withTweetLog, formatTweetLog, formatTweetLogFull, formatRunSummary, type TweetLogMap } from "../pipeline/tweetLog";
import { determineFeedSize, buildPostSelection } from "../pipeline/feedSizeStrategy";
import { ageInHours, formatCount, sortByRecencyAndImpressions, getTweetScore } from "../pipeline/tweetSorting";
import type { Post } from "../api/fetchEligiblePosts";
import PQueue from "p-queue";

const MAX_POSTS = 20;
const CONCURRENCY_LIMIT = 5;
const BACKLOG_LIMIT = 1000;

// ---------------------------------------------------------------------------
// Post fetching & selection (production-specific)
// ---------------------------------------------------------------------------

async function fetchAndSelectPosts(
  supabaseLogger: SupabaseLogger | null
): Promise<{ posts: Post[]; feedSize: string }> {
  let skipPostIds = new Set<string>();
  let allProcessedIds = new Set<string>();

  if (supabaseLogger) {
    try {
      skipPostIds = await supabaseLogger.getProcessedTweetIds();
      allProcessedIds = await supabaseLogger.getAllProcessedTweetIds();
      const backlogSize = allProcessedIds.size - skipPostIds.size;
      console.log(
        `[generate] Skipping ${skipPostIds.size} posts, ${allProcessedIds.size} total ever processed, ${backlogSize} in retry backlog`
      );
    } catch (err) {
      console.warn("[generate] Failed to get processed tweet IDs:", err);
    }
  }

  // Determine feed size
  let feedSize = "small";
  if (supabaseLogger) {
    try {
      const result = await determineFeedSize(supabaseLogger);
      feedSize = result.feedSize;
      console.log(`[generate] Feed: ${feedSize} (${result.reason})`);
    } catch (err) {
      console.warn("[generate] Failed to determine feed size, defaulting to small:", err);
    }
  }

  const postSelection = buildPostSelection(feedSize as "small" | "large" | "xl");
  const allEligible = await fetchEligiblePosts(BACKLOG_LIMIT, skipPostIds, 50, postSelection);

  // Filter stale tweets and sort by recency (0.9) + impressions (0.1)
  const { sorted, staleCount } = sortByRecencyAndImpressions(allEligible);
  if (staleCount > 0) {
    console.log(`[generate] Filtered ${staleCount} tweets older than 48h`);
  }

  const newPosts = sorted.filter((p) => !allProcessedIds.has(p.id));
  const retryPosts = sorted.filter(
    (p) => allProcessedIds.has(p.id) && !skipPostIds.has(p.id)
  );

  const backlogTotal = sorted.length;
  const backlogHitLimit = allEligible.length >= BACKLOG_LIMIT;
  console.log(
    `[generate] Backlog: ${backlogTotal} eligible tweets (${newPosts.length} new, ${retryPosts.length} retries)${backlogHitLimit ? " — hit limit, true backlog may be larger" : ""}`
  );

  // New tweets first, then fill remaining slots with retries
  const posts = [
    ...newPosts.slice(0, MAX_POSTS),
    ...retryPosts.slice(0, Math.max(0, MAX_POSTS - newPosts.length)),
  ].slice(0, MAX_POSTS);

  console.log(
    `[generate] Processing ${posts.length} of ${backlogTotal} (${posts.filter((p) => !allProcessedIds.has(p.id)).length} new + ${posts.filter((p) => allProcessedIds.has(p.id)).length} retries)`
  );

  // Log top 5 selected tweets
  for (const [i, p] of posts.slice(0, 5).entries()) {
    const imp = p.public_metrics?.impression_count ?? 0;
    const age = ageInHours(p);
    const score = getTweetScore(p, sorted);
    console.log(
      `[generate] #${i + 1}: ${p.id} | score=${score.toFixed(2)} | ${formatCount(imp)} imp | ${age.toFixed(1)}h ago`
    );
  }

  // Log run snapshot
  if (supabaseLogger) {
    try {
      await supabaseLogger.logRunSnapshot({
        backlog_total: backlogTotal,
        backlog_new: newPosts.length,
        backlog_retry: retryPosts.length,
        backlog_hit_limit: backlogHitLimit,
        posts_processed: posts.length,
        commit_sha: process.env.GITHUB_SHA,
        feed_size: feedSize,
      });
    } catch (err) {
      console.warn("[generate] Failed to log run snapshot:", err);
    }
  }

  return { posts, feedSize };
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
// Candidate storage (production-specific)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function generateCandidates(supabaseLogger: SupabaseLogger | null) {
  const commit = process.env.GITHUB_SHA;

  // Log bot probabilities (compact single line)
  const botProbs = getBotProbabilities();
  const activeBots = botProbs.filter((b) => b.probability > 0);
  console.log(`[generate] Bots: ${activeBots.map((b) => `${b.id} ${b.probability.toFixed(1)}%`).join(", ")}`);

  // Fetch and select posts
  const { posts, feedSize } = await fetchAndSelectPosts(supabaseLogger);
  if (!posts.length) {
    console.log("[generate] No eligible posts found.");
    return;
  }
  logMediaBreakdown(posts);

  // Process posts concurrently
  const queue = new PQueue({ concurrency: CONCURRENCY_LIMIT });
  const allLogs: TweetLogMap[] = [];
  let candidateCount = 0;

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

      console.log(formatTweetLog(log));
      console.log(formatTweetLogFull(log));
      allLogs.push(log);

      // If it passed all checks, store as candidate (overwriting the completion from processSingleTweet)
      if (
        tweetResult.outcome === "candidate" &&
        supabaseLogger &&
        tweetResult.pipelineRunId &&
        tweetResult.pipelineResult
      ) {
        await storeCandidateResult(
          supabaseLogger,
          tweetResult.pipelineRunId,
          post,
          selectedBot.id,
          tweetResult.noteText ?? "",
          tweetResult.pipelineResult,
          tweetResult.warnings?.join("; ")
        );
        candidateCount++;
      }
    });
  }

  await queue.onIdle();

  // Summary
  console.log(formatRunSummary(allLogs, feedSize));
  console.log(`[generate] Stored ${candidateCount} candidates`);
}
