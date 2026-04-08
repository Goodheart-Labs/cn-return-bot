/**
 * Generate & Submit Notes
 *
 * Single-pass pipeline. Fetches eligible tweets, runs bot pipelines to write
 * notes, scores them, and immediately submits passing notes (eval >= 0)
 * sorted by eval score descending.
 */

import { fetchEligiblePosts } from "../../api/fetchEligiblePosts";
import { SupabaseLogger } from "../../api/supabaseClient";
import { selectRandomBot, getBotProbabilities } from "../../bots/index";
import { processSingleTweet, type ProcessTweetResult } from "./processTweet";
import { submitNoteForTweet } from "./submitNoteForTweet";
import { createTweetLog, withTweetLog, formatTweetLogFull, formatRunSummary, type TweetLogMap } from "../utils/tweetLog";
import { determineFeedSize, buildPostSelection, type FeedSize } from "./utils/feedSizeStrategy";
// import { sortByRecencyAndImpressions, getTweetScore } from "./utils/tweetSorting";
import { ageInHours, formatCount } from "./utils/tweetSorting";
import type { Post } from "../../api/fetchEligiblePosts";
import PQueue from "p-queue";

let MAX_POSTS = 20;
const CONCURRENCY_LIMIT = 5;
const BACKLOG_LIMIT = 1000;

// ---------------------------------------------------------------------------
// Post fetching
// ---------------------------------------------------------------------------

async function fetchPosts(
  supabaseLogger: SupabaseLogger | null
): Promise<{ posts: Post[]; feedSize: FeedSize }> {
  let skipPostIds = new Set<string>();
  // let allProcessedIds = new Set<string>();

  if (supabaseLogger) {
    try {
      skipPostIds = await supabaseLogger.getAllProcessedTweetIds();
      // allProcessedIds = await supabaseLogger.getAllProcessedTweetIds();
      console.log(`[generate] Skipping ${skipPostIds.size} already-processed posts`);
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

  // const sorted = sortByRecencyAndImpressions(allEligible);

  // const newPosts = sorted.filter((p) => !allProcessedIds.has(p.id));
  // const retryPosts = sorted.filter(
  //   (p) => allProcessedIds.has(p.id) && !skipPostIds.has(p.id)
  // );

  // const backlogTotal = sorted.length;
  // const backlogHitLimit = allEligible.length >= BACKLOG_LIMIT;

  // Skip retries when candidate queue is already ≥ 2x writing limit
  // let skipRetries = false;
  // if (supabaseLogger) {
  //   try {
  //     const [writingLimitStr, candidateCount] = await Promise.all([
  //       supabaseLogger.getPipelineState("writing_limit"),
  //       supabaseLogger.countCandidates(),
  //     ]);
  //     const writingLimit = writingLimitStr ? parseInt(writingLimitStr, 10) : null;
  //     if (writingLimit !== null && candidateCount >= 2 * writingLimit) {
  //       skipRetries = true;
  //     }
  //   } catch (err) {
  //     console.warn("[generate] Failed to check writing limit:", err);
  //   }
  // }

  // const retrySlots = skipRetries ? 0 : Math.max(0, MAX_POSTS - newPosts.length);
  // const posts = [
  //   ...newPosts.slice(0, MAX_POSTS),
  //   ...retryPosts.slice(0, retrySlots),
  // ].slice(0, MAX_POSTS);

  const selected = posts.slice(0, MAX_POSTS);
  console.log(`[generate] Processing ${selected.length} tweets`);

  for (const [i, p] of selected.entries()) {
    const imp = p.public_metrics?.impression_count ?? 0;
    const age = ageInHours(p);
    // const score = getTweetScore(p, sorted);
    console.log(`[generate]   #${i + 1}: ${p.id} | ${formatCount(imp)} imp | ${age.toFixed(1)}h ago`);
  }

  if (supabaseLogger) {
    try {
      await supabaseLogger.logRunSnapshot({
        backlog_total: posts.length,
        backlog_new: posts.length,
        backlog_retry: 0,
        backlog_hit_limit: posts.length >= BACKLOG_LIMIT,
        posts_processed: Math.min(posts.length, MAX_POSTS),
        commit_sha: process.env.GITHUB_SHA,
        feed_size: feedSize,
      });
    } catch (err) {
      console.warn("[generate] Failed to log run snapshot:", err);
    }
  }

  return { posts: selected, feedSize };
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
// Submission phase (inline, after processing)
// ---------------------------------------------------------------------------

interface CandidateResult {
  post: Post;
  tweetResult: ProcessTweetResult;
  botId: string;
}

async function submitCandidatesInline(
  candidates: CandidateResult[],
  supabaseLogger: SupabaseLogger,
  dryRun: boolean
): Promise<number> {
  // Sort by eval score descending
  candidates.sort((a, b) => (b.tweetResult.evaluationScore ?? -Infinity) - (a.tweetResult.evaluationScore ?? -Infinity));

  console.log(`[submit] ${candidates.length} candidates to submit (sorted by eval score)`);

  if (dryRun) {
    for (const c of candidates) {
      console.log(`[submit]   (dry run) eval=${c.tweetResult.evaluationScore?.toFixed(2) ?? "?"} | ${c.post.id}`);
    }
    return 0;
  }

  let submitted = 0;
  for (const candidate of candidates) {
    const result = await submitNoteForTweet(
      candidate.post.id,
      candidate.tweetResult.pipelineRunId!,
      candidate.tweetResult.noteText ?? "",
      candidate.tweetResult.pipelineResult?.noteResult?.url ?? "",
      candidate.botId,
      candidate.tweetResult.evaluationScore,
      supabaseLogger,
      process.env.GITHUB_SHA,
    );

    if (result.status === "submitted") {
      submitted++;
    } else if (result.status === "daily_limit") {
      console.log(`[submit] Daily limit reached after ${submitted} submissions`);
      // Mark remaining candidates as rejected
      const remaining = candidates.slice(candidates.indexOf(candidate) + 1);
      for (const r of remaining) {
        if (r.tweetResult.pipelineRunId) {
          try {
            await supabaseLogger.completePipelineRun(r.tweetResult.pipelineRunId, {
              outcome: "rejected",
              outcome_reason: "daily_limit_reached",
              final_stage: "submission",
            });
          } catch {}
        }
      }
      break;
    } else if (result.status === "expired") {
      console.log(`[submit] Tweet ${candidate.post.id} ${result.reason} — skipping`);
    } else {
      console.log(`[submit] Error submitting ${candidate.post.id}: ${result.message} — will not retry`);
    }
  }

  return submitted;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function generateCandidates(supabaseLogger: SupabaseLogger | null, options?: { maxPosts?: number; dryRun?: boolean }) {
  if (options?.maxPosts) MAX_POSTS = options.maxPosts;
  const commit = process.env.GITHUB_SHA;

  // Log bot probabilities (compact single line)
  const botProbs = getBotProbabilities();
  const activeBots = botProbs.filter((b) => b.probability > 0);
  console.log(`[generate] Bots: ${activeBots.map((b) => `${b.id} ${b.probability.toFixed(1)}%`).join(", ")}`);

  // Fetch posts
  const { posts, feedSize } = await fetchPosts(supabaseLogger);
  if (!posts.length) {
    console.log("[generate] No eligible posts found.");
    return;
  }
  logMediaBreakdown(posts);

  // Process posts concurrently
  const queue = new PQueue({ concurrency: CONCURRENCY_LIMIT });
  const allLogs: TweetLogMap[] = [];
  const candidates: CandidateResult[] = [];

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

  console.log(`[generate] ${candidates.length} candidates, ${posts.length - candidates.length} rejected`);
  console.log(formatRunSummary(allLogs, feedSize));

  // Submit candidates sorted by eval score
  if (candidates.length > 0 && supabaseLogger) {
    const submitted = await submitCandidatesInline(candidates, supabaseLogger, options?.dryRun ?? false);
    console.log(`[submit] Submitted ${submitted} of ${candidates.length} candidates`);
  } else {
    console.log(`[submit] No candidates to submit`);
  }
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
