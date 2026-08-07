/**
 * Tweet Sorting
 *
 * Ranks tweets by a weighted blend of recency, text length, and impressions.
 * Each component is normalized to [0, 1] before weighting: length and impressions
 * against the batch's 95th percentile (clamped, so one viral / huge-article
 * outlier can't flatten everyone else), recency against a fixed 48h horizon.
 * Callers just pick the weights that fit their goal.
 */

import type { Post } from "../../../api/fetchEligiblePosts";

const MAX_AGE_HOURS = 48;
// Normalize length/impressions against the batch's p95, not its max, so a single
// outlier doesn't compress the rest of the field into a narrow low-score band.
const NORMALIZATION_PERCENTILE = 95;

/** Relative importance of each ranking signal; the weights need not sum to 1. */
export type SortWeights = { recency: number; length: number; impressions: number };

export function ageInHours(post: Post): number {
  if (!post.created_at) return MAX_AGE_HOURS;
  const createdMs = new Date(post.created_at).getTime();
  const nowMs = Date.now();
  return Math.max(0, (nowMs - createdMs) / (1000 * 60 * 60));
}

/** Format a large number compactly: 1234567 → "1.2M" */
export function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** p-th percentile of `values` (linear interpolation between ranks). */
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
