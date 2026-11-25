/**
 * Small helpers for describing tweets in logs: a tweet's age and a compact
 * count. The weighted ranking that used to live here served only the July 2026
 * Pangram pre-pass, which GOO-880 replaced.
 */

import type { Post } from "../../../api/fetchEligiblePosts";

const MAX_AGE_HOURS = 48;

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
