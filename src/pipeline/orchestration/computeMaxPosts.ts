/**
 * Work out how many tweets to process this run. The budget comes from the
 * writing slots we have left and from the recent rate at which processed tweets
 * turn into candidates or submissions.
 */

import type { SupabaseLogger } from "../../api/supabaseClient";
import { hitWritingLimitRecently, readWritingLimit } from "./writingLimit";

const WRITING_LIMIT_WINDOW_HOURS = 24;
const RATE_SAMPLE_WINDOW_HOURS = 32;
export const MAX_POSTS_CAP = 20;
const SAFETY_MULTIPLIER = 1.25;
const FALLBACK_MAX_POSTS = 5;
const MIN_RUNS_FOR_RATE = 20;
// We only ration posts against the writing limit while we are confident the
// limit really binds, which means we hit it inside this window. Once the window
// has passed the stored limit is stale. It is then a guess we probed upward to,
// not a proven cap. So we stop rationing and process the full per-run maximum.
const CONFIDENT_LIMIT_WINDOW_HOURS = 12;
const CONVERTED_OUTCOMES = ["candidate", "submitted"];

export interface MaxPostsResult {
  /** How many posts to actually process this run. It is capped at
   *  MAX_POSTS_CAP. */
  maxPosts: number;
  /** An uncapped estimate of how many posts we would need to process to reach
   *  the writing limit. Nothing acts on it today. It is only logged, so a run
   *  shows what the rate-based budget looked like before the cap. On the
   *  fallback paths there is no rate-based estimate, so it equals maxPosts. */
  estimate: number;
}

export async function computeMaxPosts(logger: SupabaseLogger): Promise<MaxPostsResult> {
  const budget = await estimateWritingBudget(logger);

  // Past the confidence window the stored limit is stale, so stop rationing and
  // process the full per-run maximum. Still return the estimate we would
  // otherwise have used, so the logs show what the rate-based budget looked
  // like.
  if (!(await hitWritingLimitRecently(logger, CONFIDENT_LIMIT_WINDOW_HOURS))) {
    console.log(
      `[max-posts] no binding writing-limit hit in last ${CONFIDENT_LIMIT_WINDOW_HOURS}h` +
        ` — estimate=${budget.estimate} overridden → maxPosts=${MAX_POSTS_CAP}`,
    );
    return { maxPosts: MAX_POSTS_CAP, estimate: budget.estimate };
  }
  return budget;
}

async function estimateWritingBudget(logger: SupabaseLogger): Promise<MaxPostsResult> {
  const writingLimit = await readWritingLimit(logger);
  if (writingLimit === null) {
    console.log(`[max-posts] writing_limit unknown — using fallback ${FALLBACK_MAX_POSTS}`);
    return { maxPosts: FALLBACK_MAX_POSTS, estimate: FALLBACK_MAX_POSTS };
  }

  const submissions = await logger.countRecentSubmissions(WRITING_LIMIT_WINDOW_HOURS);
  const remainingSlots = Math.max(writingLimit - submissions, 0);
  if (remainingSlots === 0) {
    console.log(`[max-posts] limit=${writingLimit} submitted=${submissions} remaining=0 maxPosts=0`);
    return { maxPosts: 0, estimate: 0 };
  }

  const totalRuns = await logger.countRecentPipelineRuns(RATE_SAMPLE_WINDOW_HOURS);
  if (totalRuns < MIN_RUNS_FOR_RATE) {
    console.log(`[max-posts] only ${totalRuns} runs in last ${RATE_SAMPLE_WINDOW_HOURS}h — using fallback ${FALLBACK_MAX_POSTS}`);
    return { maxPosts: FALLBACK_MAX_POSTS, estimate: FALLBACK_MAX_POSTS };
  }

  const convertedRuns = await logger.countRecentPipelineRunsByOutcomes(RATE_SAMPLE_WINDOW_HOURS, CONVERTED_OUTCOMES);
  const conversionRate = convertedRuns / totalRuns;
  if (conversionRate === 0) {
    console.log(`[max-posts] conversion rate is 0 (${convertedRuns}/${totalRuns}) — using fallback ${FALLBACK_MAX_POSTS}`);
    return { maxPosts: FALLBACK_MAX_POSTS, estimate: FALLBACK_MAX_POSTS };
  }

  const estimate = Math.ceil((remainingSlots / conversionRate) * SAFETY_MULTIPLIER);
  const maxPosts = Math.min(estimate, MAX_POSTS_CAP);
  console.log(
    `[max-posts] limit=${writingLimit} submitted=${submissions} remaining=${remainingSlots}` +
      ` rate=${conversionRate.toFixed(3)} (${convertedRuns}/${totalRuns}) estimate=${estimate} maxPosts=${maxPosts}`,
  );
  return { maxPosts, estimate };
}
