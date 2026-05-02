/**
 * Compute how many tweets to process this run, based on remaining writing slots
 * and the recent rate at which processed tweets become candidates/submissions.
 */

import type { SupabaseLogger } from "../../api/supabaseClient";
import { readWritingLimit } from "./writingLimit";

const WINDOW_HOURS = 24;
const MAX_POSTS_CAP = 20;
const SAFETY_MULTIPLIER = 1.25;
const FALLBACK_MAX_POSTS = 5;
const MIN_RUNS_FOR_RATE = 20;
const CONVERTED_OUTCOMES = ["candidate", "submitted"];

export async function computeMaxPosts(logger: SupabaseLogger): Promise<number> {
  const writingLimit = await readWritingLimit(logger);
  if (writingLimit === null) {
    console.log(`[max-posts] writing_limit unknown — using fallback ${FALLBACK_MAX_POSTS}`);
    return FALLBACK_MAX_POSTS;
  }

  const submissions = await logger.countRecentSubmissions(WINDOW_HOURS);
  const remainingSlots = Math.max(writingLimit - submissions, 0);
  if (remainingSlots === 0) {
    console.log(`[max-posts] limit=${writingLimit} submitted=${submissions} remaining=0 maxPosts=0`);
    return 0;
  }

  const totalRuns = await logger.countRecentPipelineRuns(WINDOW_HOURS);
  if (totalRuns < MIN_RUNS_FOR_RATE) {
    console.log(`[max-posts] only ${totalRuns} runs in last ${WINDOW_HOURS}h — using fallback ${FALLBACK_MAX_POSTS}`);
    return FALLBACK_MAX_POSTS;
  }

  const convertedRuns = await logger.countRecentPipelineRunsByOutcomes(WINDOW_HOURS, CONVERTED_OUTCOMES);
  const conversionRate = convertedRuns / totalRuns;
  if (conversionRate === 0) {
    console.log(`[max-posts] conversion rate is 0 (${convertedRuns}/${totalRuns}) — using fallback ${FALLBACK_MAX_POSTS}`);
    return FALLBACK_MAX_POSTS;
  }

  const target = Math.ceil((remainingSlots / conversionRate) * SAFETY_MULTIPLIER);
  const maxPosts = Math.min(target, MAX_POSTS_CAP);
  console.log(
    `[max-posts] limit=${writingLimit} submitted=${submissions} remaining=${remainingSlots}` +
      ` rate=${conversionRate.toFixed(3)} (${convertedRuns}/${totalRuns}) target=${target} maxPosts=${maxPosts}`,
  );
  return maxPosts;
}
