/**
 * Compute how many tweets to process this run, based on remaining writing slots
 * and the recent rate at which processed tweets become candidates/submissions.
 */

import type { SupabaseLogger } from "../../api/supabaseClient";
import { readWritingLimit } from "./writingLimit";

const WRITING_LIMIT_WINDOW_HOURS = 24;
const RATE_SAMPLE_WINDOW_HOURS = 32;
export const MAX_POSTS_CAP = 30;
const SAFETY_MULTIPLIER = 1.25;
const FALLBACK_MAX_POSTS = 5;
const MIN_RUNS_FOR_RATE = 20;
const CONVERTED_OUTCOMES = ["candidate", "submitted"];

export interface MaxPostsResult {
  /** How many posts to actually process this run (capped at MAX_POSTS_CAP). */
  maxPosts: number;
  /** Uncapped estimate of how many posts we'd need to process to hit the
   *  writing limit. Drives feed breadth (broaden past the small feed only when
   *  demand is high). Equals maxPosts on the fallback paths, where no rate-based
   *  estimate is available. */
  estimate: number;
}

export async function computeMaxPosts(logger: SupabaseLogger): Promise<MaxPostsResult> {
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
