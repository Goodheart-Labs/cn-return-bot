/**
 * Tweet Sorting
 *
 * Sorts eligible tweets by a weighted combination of recency (dominant)
 * and impressions (secondary). Filters out stale tweets beyond MAX_AGE_HOURS.
 */

import type { Post } from "../api/fetchEligiblePosts";

const RECENCY_WEIGHT = 0.8;
const IMPRESSION_WEIGHT = 0.2;
const MAX_AGE_HOURS = 48;

export function ageInHours(post: Post): number {
  if (!post.created_at) return MAX_AGE_HOURS;
  const createdMs = new Date(post.created_at).getTime();
  const nowMs = Date.now();
  return Math.max(0, (nowMs - createdMs) / (1000 * 60 * 60));
}

function recencyScore(post: Post): number {
  return Math.max(0, 1 - ageInHours(post) / MAX_AGE_HOURS);
}

function impressionScore(post: Post, maxLogImp: number): number {
  if (maxLogImp <= 0) return 0;
  const imp = post.public_metrics?.impression_count ?? 0;
  return Math.log10(imp + 1) / maxLogImp;
}

function combinedScore(post: Post, maxLogImp: number): number {
  return RECENCY_WEIGHT * recencyScore(post) + IMPRESSION_WEIGHT * impressionScore(post, maxLogImp);
}

/**
 * Filter tweets older than 48h, then sort by weighted recency + impressions.
 * Returns the filtered+sorted array and the count of stale tweets removed.
 */
export function sortByRecencyAndImpressions(posts: Post[]): { sorted: Post[]; staleCount: number } {
  const filtered = posts.filter((p) => ageInHours(p) <= MAX_AGE_HOURS);
  const staleCount = posts.length - filtered.length;

  const maxLogImp = filtered.reduce((max, p) => {
    const val = Math.log10((p.public_metrics?.impression_count ?? 0) + 1);
    return val > max ? val : max;
  }, 0);

  filtered.sort((a, b) => combinedScore(b, maxLogImp) - combinedScore(a, maxLogImp));

  return { sorted: filtered, staleCount };
}

/** Get the combined score for a post (for logging) */
export function getTweetScore(post: Post, allPosts: Post[]): number {
  const maxLogImp = allPosts.reduce((max, p) => {
    const val = Math.log10((p.public_metrics?.impression_count ?? 0) + 1);
    return val > max ? val : max;
  }, 0);
  return combinedScore(post, maxLogImp);
}

/** Format a large number compactly: 1234567 → "1.2M" */
export function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
