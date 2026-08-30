/**
 * Tweet Sorting
 *
 * Ranks tweets by a weighted blend of recency, text length, and impressions.
 * Every part is normalized to a value between 0 and 1 before it is weighted.
 * Length and impressions are measured against the batch's 95th percentile and
 * clamped there, so one viral post or one very long article cannot flatten
 * everyone else. Recency is measured against a fixed horizon of 48 hours.
 * Callers only have to pick the weights that fit their goal.
 */

import type { Post } from "../../../api/fetchEligiblePosts";

const MAX_AGE_HOURS = 48;
// Length and impressions are normalized against the batch's 95th percentile
// rather than its maximum. Using the maximum would let a single outlier squeeze
// every other post into a narrow band of low scores.
const NORMALIZATION_PERCENTILE = 95;

/** How much each ranking signal counts. The weights do not have to add up to 1. */
export type SortWeights = { recency: number; length: number; impressions: number };

export function ageInHours(post: Post): number {
  if (!post.created_at) return MAX_AGE_HOURS;
  const createdMs = new Date(post.created_at).getTime();
  const nowMs = Date.now();
  return Math.max(0, (nowMs - createdMs) / (1000 * 60 * 60));
}

/** Formats a large number compactly. For example 1234567 becomes "1.2M". */
export function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Returns the p-th percentile of `values`. Values between two ranks are
 *  interpolated linearly. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const loVal = sorted[lo] ?? 0;
  const hiVal = sorted[Math.ceil(rank)] ?? loVal;
  return loVal + (hiVal - loVal) * (rank - lo);
}

function recencyScore(post: Post): number {
  return 1 - ageInHours(post) / MAX_AGE_HOURS;
}

function lengthScore(post: Post, lengthDenom: number): number {
  if (lengthDenom <= 0) return 0;
  return Math.min(1, (post.text?.length ?? 0) / lengthDenom);
}

function impressionScore(post: Post, logImpDenom: number): number {
  if (logImpDenom <= 0) return 0;
  const imp = post.public_metrics?.impression_count ?? 0;
  return Math.min(1, Math.log10(imp + 1) / logImpDenom);
}

export function sortByWeightedScore(posts: Post[], weights: SortWeights): Post[] {
  const lengthDenom = percentile(
    posts.map((p) => p.text?.length ?? 0),
    NORMALIZATION_PERCENTILE,
  );
  const logImpDenom = percentile(
    posts.map((p) => Math.log10((p.public_metrics?.impression_count ?? 0) + 1)),
    NORMALIZATION_PERCENTILE,
  );

  const score = (post: Post) =>
    weights.recency * recencyScore(post) +
    weights.length * lengthScore(post, lengthDenom) +
    weights.impressions * impressionScore(post, logImpDenom);

  return [...posts].sort((a, b) => score(b) - score(a));
}
