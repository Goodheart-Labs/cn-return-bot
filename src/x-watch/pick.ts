/**
 * Which posts of a walk cn-x-watch hands to Claude (GOO-874). This module
 * touches no database, so its rules can be tested with made-up walks.
 *
 * A post is worth a note in proportion to the views it still gets. So each
 * walk scores every post with its predicted views still to come
 * (src/pipeline/utils/viewsToCome.ts), and a post goes to Claude only when its
 * score clears a threshold. The threshold is set so that, at the rate posts
 * arrived in the feed over the last 7 days, just enough posts clear it to fill
 * the writing limit:
 *
 *   1. Claude writes a note on only some of the posts it gets: on 53 of 264
 *      during the test notes. So filling a writing limit of 10 notes a day at
 *      that note rate takes 10 / 0.2 = 50 posts a day.
 *   2. The database lists the posts that arrived in the feed in the last 7
 *      days with the best score each one had (x_watch_best_scores, migration
 *      203). If 1,000 posts arrived in those 7 days, 50 posts a day are the 350
 *      best of them, and the threshold is the score of the 350th.
 *
 * A post that clears the threshold still waits while the room is full
 * (room.ts). If more posts clear it than the room takes, the best scores go
 * first, and the others get their turn while they still clear it. A threshold
 * that is a little low thus costs nothing. One that is too high leaves room
 * unused.
 *
 * Right after the first deploy there is no history to set the threshold from.
 * Until MIN_HISTORY_HOURS have passed, no post goes to Claude.
 */

import { isPossiblySensitive, type Post } from "../api/fetchEligiblePosts";

export const SCORE_HISTORY_DAYS = 7;
/** A shorter history says too little about how many posts arrive. */
const MIN_HISTORY_HOURS = 3;
/** A note rate this low or lower would let almost every post through. */
const MIN_NOTE_RATE = 0.05;

/** The posts that arrived in the feed over `hours`, with each one's best
 *  score, best first. */
export type ScoreHistory = { hours: number; bestScores: number[] };

export type ScoredPost = { post: Post; viewsToCome: number };

/** How many posts a day should go to Claude to fill the writing limit, given
 *  the share of posts that get a note. */
export const postsPerDay = (writingLimit: number, noteRate: number) => writingLimit / Math.max(noteRate, MIN_NOTE_RATE);

/** The score a post must reach to go to Claude, or null while the history is
 *  too short to tell. 0 when fewer posts arrive than the limit could take. */
export function viewsThreshold(history: ScoreHistory, wantedPerDay: number): number | null {
  if (history.hours < MIN_HISTORY_HOURS) return null;
  const wantedInHistory = Math.max(1, Math.round((wantedPerDay * history.hours) / 24));
  return history.bestScores[wantedInHistory - 1] ?? 0;
}

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
