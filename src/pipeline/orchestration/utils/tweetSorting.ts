/**
 * Tweet Sorting
 *
 * Ranks tweets by a weighted blend of recency, text length, and impressions.
 * Each component is normalized to [0, 1] across the batch before weighting, so
 * callers just pick the weights that fit their goal.
 */

import type { Post } from "../../../api/fetchEligiblePosts";

const MAX_AGE_HOURS = 48;

/** Relative importance of each ranking signal; the weights need not sum to 1. */
export type SortWeights = { recency: number; length: number; impressions: number };

const RECENCY_AND_IMPRESSIONS: SortWeights = { recency: 0.8, length: 0, impressions: 0.2 };

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

function recencyScore(post: Post): number {
  return 1 - ageInHours(post) / MAX_AGE_HOURS;
}

function lengthScore(post: Post, maxLength: number): number {
  if (maxLength <= 0) return 0;
  return (post.text?.length ?? 0) / maxLength;
}

function impressionScore(post: Post, maxLogImp: number): number {
  if (maxLogImp <= 0) return 0;
  const imp = post.public_metrics?.impression_count ?? 0;
  return Math.log10(imp + 1) / maxLogImp;
}

export function sortByWeightedScore(posts: Post[], weights: SortWeights): Post[] {
  const maxLength = posts.reduce((max, p) => Math.max(max, p.text?.length ?? 0), 0);
  const maxLogImp = posts.reduce(
    (max, p) => Math.max(max, Math.log10((p.public_metrics?.impression_count ?? 0) + 1)),
    0,
  );

  const score = (post: Post) =>
    weights.recency * recencyScore(post) +
    weights.length * lengthScore(post, maxLength) +
    weights.impressions * impressionScore(post, maxLogImp);

  return [...posts].sort((a, b) => score(b) - score(a));
}

export function sortByRecencyAndImpressions(posts: Post[]): Post[] {
  return sortByWeightedScore(posts, RECENCY_AND_IMPRESSIONS);
}
