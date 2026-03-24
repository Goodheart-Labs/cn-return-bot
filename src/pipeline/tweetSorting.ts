/**
 * Tweet Sorting
 *
 * Sorts eligible tweets by a weighted combination of recency (dominant)
 * and impressions (secondary). Recency score is 0 for tweets >= MAX_AGE_HOURS old.
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
 * Sort tweets by weighted recency + impressions.
 * Tweets older than 48h get a recency score of 0 but are still included.
 */
export function sortByRecencyAndImpressions(posts: Post[]): Post[] {
  const maxLogImp = posts.reduce((max, p) => {
    const val = Math.log10((p.public_metrics?.impression_count ?? 0) + 1);
    return val > max ? val : max;
  }, 0);

  return [...posts].sort((a, b) => combinedScore(b, maxLogImp) - combinedScore(a, maxLogImp));
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
