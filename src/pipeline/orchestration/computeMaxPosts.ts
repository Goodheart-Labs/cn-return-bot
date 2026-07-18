/**
 * Compute how many tweets to process this run.
 *
 * We *predict* X's current daily writing limit from our own note history
 * (predictWritingLimit) and budget generation against a **half-step** toward it,
 * instead of only reacting after X 403s us. Prediction failures fall back to the
 * legacy observed-cap rationing so posting never breaks on a predictor bug.
 */

import type { SupabaseLogger } from "../../api/supabaseClient";
import { hitWritingLimitRecently, readWritingLimit } from "./writingLimit";
import { predictWritingLimit } from "./predictWritingLimit";

const WRITING_LIMIT_WINDOW_HOURS = 24;
const RATE_SAMPLE_WINDOW_HOURS = 32;
export const MAX_POSTS_CAP = 20;
const SAFETY_MULTIPLIER = 1.25;
const FALLBACK_MAX_POSTS = 5;
const MIN_RUNS_FOR_RATE = 20;
const CONVERTED_OUTCOMES = ["candidate", "submitted"];

// ── Reserve margin — DELIBERATE, do not "fix" this to post the full predicted cap ──
// We compute a predicted writing limit but cap 24h submissions at only
// POST_FRACTION_OF_PREDICTED of it, holding the rest (~15%) in reserve. Why:
//   1. The prediction is a reconstruction of X's (ambiguous, n=1-validated) formula
//      — a fixed under-shoot means a wrong-HIGH prediction still can't get us 403'd.
//   2. Posting marginal notes dilutes our helpful-note hit rate, which *lowers* the
//      future cap — so restraint is self-protecting.
// NOTE this is a STABLE CEILING, not a per-run "half-step": a half-step re-counts
// submissions each run and geometrically converges to the *full* cap over a few runs
// (12→16→18→19→20), leaving no reserve. Capping at floor(fraction × predicted) instead
// means submissions never exceed the target in the 24h window, so the reserve persists.
// 0.85 is a conservative start; dial toward 1.0 as the predictor earns trust
// (predicted-vs-observed logged every run + on each 403, see writingLimit.ts).
// Nathan, 2026-07-18 — rationale in docs/note-ranking-plan.md.
const POST_FRACTION_OF_PREDICTED = 0.85;

// After X actually refuses a submission, cool off briefly before probing again so
// we don't hammer the 403. Deliberately SHORT (not a multi-hour wait) so that a
// silently-raised limit is rediscovered within about an hour.
const POST_403_COOLDOWN_HOURS = 1;

export interface MaxPostsResult {
  /** How many posts to actually process this run (capped at MAX_POSTS_CAP). */
  maxPosts: number;
  /** Uncapped estimate of posts we'd process to fill the slot budget; drives feed breadth. */
  estimate: number;
}

export async function computeMaxPosts(logger: SupabaseLogger): Promise<MaxPostsResult> {
  const prediction = await predictWritingLimit();

  if (prediction === null) {
    // Fail-soft: predictor couldn't read enough data → fall back to the legacy
    // observed-cap rationing so posting keeps working on a predictor failure.
    console.warn("[posting-strategy] prediction unavailable — falling back to observed-cap rationing");
    return legacyObservedBudget(logger);
  }

  const submitted = await logger.countRecentSubmissions(WRITING_LIMIT_WINDOW_HOURS);
  // Persist the prediction so predicted-vs-observed drift is queryable, and so
  // recordDailyLimitHit can log the miss when X refuses (calibration).
  await logger.setPipelineState("predicted_writing_limit", String(prediction.wl));

  // Stable ceiling: post up to a fixed fraction of the predicted cap, keeping the
  // rest in reserve (see POST_FRACTION_OF_PREDICTED). Because it's an absolute cap on
  // 24h submissions (not a re-counted step), the reserve persists across runs.
  const targetCap = Math.floor(POST_FRACTION_OF_PREDICTED * prediction.wl);
  let remainingSlots = Math.max(0, targetCap - submitted);

  const coolingOff = await hitWritingLimitRecently(logger, POST_403_COOLDOWN_HOURS);
  if (coolingOff) remainingSlots = 0;

  console.log(
    `[posting-strategy] predicted_WL=${prediction.wl} (${prediction.branch}) ` +
      `target=${targetCap} (${POST_FRACTION_OF_PREDICTED}×predicted → ~15% reserve) ` +
      `submitted_24h=${submitted} remaining=${remainingSlots}${coolingOff ? " (cooling off post-403)" : ""} | ` +
      `HR_L=${pct(prediction.HR_L)} HR_100=${pct(prediction.HR_100)} HR_14d=${pct(prediction.HR_14d)} ` +
      `DN30=${prediction.DN_30.toFixed(1)} NH5=${prediction.NH_5} NH10=${prediction.NH_10} T=${prediction.T}`,
  );

  if (remainingSlots === 0) return { maxPosts: 0, estimate: 0 };
  return postsFromRemainingSlots(logger, remainingSlots);
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/** Legacy fallback: ration against the last *observed* cap (only when prediction fails). */
async function legacyObservedBudget(logger: SupabaseLogger): Promise<MaxPostsResult> {
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
  return postsFromRemainingSlots(logger, remainingSlots);
}

/**
 * Turn a slot budget into a per-run post count using our recent
 * candidate-conversion rate (most processed tweets never become a note).
 */
async function postsFromRemainingSlots(logger: SupabaseLogger, remainingSlots: number): Promise<MaxPostsResult> {
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
    `[max-posts] remaining=${remainingSlots} rate=${conversionRate.toFixed(3)} (${convertedRuns}/${totalRuns}) estimate=${estimate} maxPosts=${maxPosts}`,
  );
  return { maxPosts, estimate };
}
