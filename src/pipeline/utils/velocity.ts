/**
 * Post velocity: impressions per hour accumulated since posting, measured with
 * whatever impression count we currently hold (frozen at fetch time for
 * pipeline posts). Velocity at first sight strongly predicts whether a note
 * ever gets rated/displayed — see the analysis in
 * src/scripts_rob/2026_07_20_rating_velocity/ (this formula matches its
 * export_slider.ts definition, including the age clamp).
 *
 * Deliberately does NOT reuse tweetSorting's ageInHours: that helper falls
 * back to 48h when created_at is missing, which here would turn an unknown
 * timestamp into a near-zero velocity — the opposite of the fail-open
 * semantics floor callers need. Missing/invalid inputs return null, and
 * callers must treat null as "above any floor" (never cut on unknown data).
 */

import type { Post } from "../../api/fetchEligiblePosts";
import { formatCount } from "../orchestration/utils/tweetSorting";

/** Posts younger than this are measured as if this old: a 3-minute-old post's
 *  raw impressions/age is mostly sampling noise, so the clamp makes very-young
 *  velocities conservative instead of explosive. */
export const VELOCITY_MIN_AGE_HOURS = 0.25;

/**
 * Impressions per hour since posting, as of `asOfMs` (default: now). Returns
 * null when the impression count or timestamp is missing/invalid — callers
 * fail OPEN on null (a feed-shape change must never silently zero
 * submissions). A negative age (clock skew) clamps to the minimum age, the
 * fail-open direction.
 */
export function velocityPerHour(post: Post, asOfMs: number = Date.now()): number | null {
  const impressions = post.public_metrics?.impression_count;
  if (impressions == null || !post.created_at) return null;
  const createdMs = new Date(post.created_at).getTime();
  if (!Number.isFinite(createdMs)) return null;
  const ageHours = (asOfMs - createdMs) / (1000 * 60 * 60);
  return impressions / Math.max(ageHours, VELOCITY_MIN_AGE_HOURS);
}

/** "12.3K/h" for logs; "?" when velocity is unknown. */
export function formatVelocity(v: number | null): string {
  return v == null ? "?" : `${formatCount(Math.round(v))}/h`;
}
