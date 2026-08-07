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

// ── Regular-feed velocity floor ─────────────────────────────────────────────
// Experiment (week of 2026-07-20). A post's velocity — impressions/hour at the
// moment we fetched it — strongly predicts whether its note ever gets rated:
// 56% of recent submissions were below the historical median velocity, where
// notes mostly sit unread (analysis: src/scripts_rob/2026_07_20_rating_velocity).
// With the daily cap binding, the goal is not keeping every possible winner but
// maximizing the hit rate of the few submissions the cap allows.
//
// Enforced at feed SELECTION (generateCandidates): each tier is filtered to
// above-floor posts and the ladder broadens until maxPosts of them are pooled,
// so a slow post never costs a pipeline run in the first place. submitCandidates
// re-checks it as a backstop for candidates that skip selection (the Pangram
// pre-pass; topic posts answer to MISINFO_TOPIC_VELOCITY_FLOOR_PER_HOUR below,
// enforced at both topic selection points). Set 0 to disable.
export const REGULAR_VELOCITY_FLOOR_PER_HOUR = 15_000;

// ── Topic velocity floor ────────────────────────────────────────────────────
// Experiment (week of 2026-07-20; analysis in
// src/scripts_rob/2026_07_20_rating_velocity): the chance a post's note is
// ever rated collapses at low velocity (impressions/hour at sighting), and
// topic notes are expensive (full pipeline + injected reference doc) — so the
// slots reserved for topic posts should go to fast posts only. One floor, one
// policy, enforced at BOTH topic discovery routes: the pre-pass work list
// (generateMisinfoCandidates.buildWorkList) and the regular-pool curation fill
// (regularFeedTopicCuration.fillWithTopicPriority). Below-floor posts are
// dropped and logged, not queued; their stored sighting verdict makes retries
// free, and a post that accelerates in a later fetch clears the floor then.
// Unknown velocity fails OPEN. Set 0 to disable. If fewer than ~5 qualifying
// posts/day survive the full note-writing funnel for two consecutive days,
// lower this to 2_000 (the display-collapse threshold from the analysis).
export const MISINFO_TOPIC_VELOCITY_FLOOR_PER_HOUR = 4_000;

/**
 * Floor test over an already-computed velocity. Unknown velocity (null) is
 * ABOVE the floor: a feed-shape change that drops impression counts must never
 * silently zero the pipeline. A floor of 0 (or less) disables the check.
 */
export function isAboveFloor(velocity: number | null, floor: number): boolean {
  return floor <= 0 || velocity === null || velocity >= floor;
}

/** isAboveFloor against the REGULAR feed floor. Topic-path callers should use
 *  isAboveFloor with MISINFO_TOPIC_VELOCITY_FLOOR_PER_HOUR instead. */
export function isAboveVelocityFloor(velocity: number | null): boolean {
  return isAboveFloor(velocity, REGULAR_VELOCITY_FLOOR_PER_HOUR);
}
