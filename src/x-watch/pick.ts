/**
 * Which posts of a walk cn-x-watch hands to Claude (GOO-874). This module
 * touches no database, so its rules can be tested with made-up walks.
 *
 * A post goes to Claude when its predicted views still to come clear the
 * threshold of src/pipeline/utils/viewsThreshold.ts, which lets through as
 * many posts as fill the writing limit at Claude's note rate. A post that
 * clears the threshold still waits while the room is full (room.ts). If more
 * posts clear it than the room takes, the best scores go first, and the
 * others get their turn while they still clear it.
 */

import { isPossiblySensitive, type Post } from "../api/fetchEligiblePosts";

/** A note rate this low or lower would let almost every post through. */
export const MIN_NOTE_RATE = 0.05;

export type ScoredPost = { post: Post; viewsToCome: number };

/** The posts to hand over now, best first, at most `room` of them. Each needs
 *  a positive score at the threshold or above. Posts X marked as possibly
 *  sensitive are left out, as in the X run. */
export function pickPosts(scored: ScoredPost[], handledTweetIds: Set<string>, room: number, threshold: number): ScoredPost[] {
  if (room <= 0) return [];
  return scored
    .filter((s) => s.viewsToCome > 0 && s.viewsToCome >= threshold && !handledTweetIds.has(s.post.id) && !isPossiblySensitive(s.post))
    .sort((a, b) => b.viewsToCome - a.viewsToCome)
    .slice(0, room);
}
