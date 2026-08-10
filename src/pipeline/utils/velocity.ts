/**
 * Post velocity is the number of impressions per hour a post has gathered
 * since it was posted. It is measured with whatever impression count we
 * currently hold. For posts that go through the pipeline that count is frozen
 * at the moment we fetched the post.
 *
 * The velocity a post has the first time we see it strongly predicts whether
 * its note is ever rated or displayed. The analysis is in
 * src/scripts_rob/2026_07_20_rating_velocity/. This formula matches the
 * definition in that folder's export_slider.ts, including the age clamp.
 *
 * This module deliberately does not reuse ageInHours from tweetSorting. That
 * helper falls back to 48 hours when created_at is missing. Here that would
 * turn an unknown timestamp into a velocity close to zero, which is the
 * opposite of what the floor callers need. Missing or invalid inputs return
 * null instead. Callers must treat null as being above any floor, so that we
 * never cut a post on data we do not have.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import { formatCount } from "../orchestration/utils/tweetSorting";

/** A post younger than this many hours is measured as if it were exactly this
 *  old. The raw impressions per hour of a three-minute-old post is mostly
 *  sampling noise. Clamping the age keeps the velocity of a very young post
 *  conservative instead of explosive. */
export const VELOCITY_MIN_AGE_HOURS = 0.25;

/**
 * Returns the impressions per hour the post has gathered since it was posted,
 * measured as of `asOfMs`. That argument defaults to the current time.
 * Returns null when the impression count or the timestamp is missing or
 * invalid. Callers fail open on null, because a change in the shape of the feed
 * must never silently stop us from submitting notes. A negative age comes from
 * clock skew. It clamps to the minimum age, which is also the fail-open
 * direction.
 */
export function velocityPerHour(post: Post, asOfMs: number = Date.now()): number | null {
  const impressions = post.public_metrics?.impression_count;
  if (impressions == null || !post.created_at) return null;
  const createdMs = new Date(post.created_at).getTime();
  if (!Number.isFinite(createdMs)) return null;
  const ageHours = (asOfMs - createdMs) / (1000 * 60 * 60);
  return impressions / Math.max(ageHours, VELOCITY_MIN_AGE_HOURS);
}

/** Formats a velocity for logs, for example "12.3K/h". An unknown velocity
 *  becomes "?". */
export function formatVelocity(v: number | null): string {
  return v == null ? "?" : `${formatCount(Math.round(v))}/h`;
}

// ── Regular-feed velocity floor ─────────────────────────────────────────────
// This floor comes from an experiment run in the week of 2026-07-20. A post's
// velocity is its impressions per hour at the moment we fetched it. It strongly
// predicts whether the post's note is ever rated. 56% of recent submissions
// were below the historical median velocity, and notes on those posts mostly
// sit unread. The analysis is in src/scripts_rob/2026_07_20_rating_velocity.
// The daily cap on submissions is binding, so the goal is not to keep every
// possible winner. The goal is to maximize the hit rate of the few submissions
// the cap allows.
//
// The floor is enforced when the feed is selected, in generateCandidates. Each
// tier is filtered down to above-floor posts, and the ladder broadens until
// maxPosts of them are pooled. A slow post therefore never costs a pipeline run
// in the first place. submitCandidates checks the floor again as a backstop for
// candidates that never went through selection, such as those from the Pangram
// pre-pass. Topic posts answer to MISINFO_TOPIC_VELOCITY_FLOOR_PER_HOUR below
// instead. Set this to 0 to disable the floor.
export const REGULAR_VELOCITY_FLOOR_PER_HOUR = 15_000;

// ── Topic velocity floor ────────────────────────────────────────────────────
// This floor comes from the same experiment in the week of 2026-07-20. The
// analysis is in src/scripts_rob/2026_07_20_rating_velocity. The chance that a
// post's note is ever rated collapses once the velocity at the moment we saw
// the post is low. Topic notes are also expensive, because they run the full
// pipeline and inject a reference document. So the slots we reserve for topic
// posts should go to fast posts only.
//
// There is one floor and one policy, enforced at both routes that discover
// topic posts. The first is the pre-pass work list in
// generateMisinfoCandidates.buildWorkList. The second is the curation fill on
// the regular pool in regularFeedTopicCuration.fillWithTopicPriority. Posts
// below the floor are dropped and logged rather than queued. Their stored
// sighting verdict makes a later retry free. A post that speeds up before a
// later fetch clears the floor then.
//
// An unknown velocity fails open. Set this to 0 to disable the floor. If fewer
// than about 5 qualifying posts a day survive the whole note-writing funnel on
// two days in a row, lower this to 2_000. That is the velocity at which the
// analysis found display collapsing.
export const MISINFO_TOPIC_VELOCITY_FLOOR_PER_HOUR = 4_000;

/**
 * Tests an already-computed velocity against a floor. An unknown velocity,
 * which arrives as null, counts as being above the floor. A change in the shape
 * of the feed that drops impression counts must never silently stop the
 * pipeline. A floor of 0 or less disables the check entirely.
 */
export function isAboveFloor(velocity: number | null, floor: number): boolean {
  return floor <= 0 || velocity === null || velocity >= floor;
}

/** Runs isAboveFloor against the regular feed floor. Callers on the topic path
 *  should call isAboveFloor with MISINFO_TOPIC_VELOCITY_FLOOR_PER_HOUR
 *  instead. */
export function isAboveVelocityFloor(velocity: number | null): boolean {
  return isAboveFloor(velocity, REGULAR_VELOCITY_FLOOR_PER_HOUR);
}
