/**
 * The views threshold that lets just enough posts through to fill a daily
 * limit (GOO-874, GOO-880). cn-x-watch uses it to pick the WSDM Cup account's
 * posts. The first account's Pangram pass uses it to pick the long-form posts
 * it sends to Pangram. This module touches no database.
 *
 * A post is worth a note in proportion to the views it still gets. So each
 * walk scores every post with its predicted views still to come
 * (viewsToCome.ts), and a post is checked only when its score clears the
 * threshold. The threshold is set so that, at the rate posts arrived over the
 * last 7 days, just enough posts clear it to fill the limit:
 *
 *   1. Only some of the checked posts get a note. Claude wrote a note on 53
 *      of 264 posts during the WSDM Cup test notes. So filling a limit of 10
 *      notes a day at that note rate takes 10 / 0.2 = 50 posts a day.
 *   2. The history lists the posts that arrived in the last 7 days, each with
 *      the best score it had. If 1,000 posts arrived in those 7 days, 50 posts
 *      a day are the 350 best of them, and the threshold is the score of the
 *      350th.
 *
 * A threshold that is a little low costs nothing when the caller also caps
 * how many posts it checks. One that is too high leaves the limit unused.
 *
 * Right after a first deploy there is no history to set the threshold from.
 * Until MIN_HISTORY_HOURS have passed, no post clears it.
 */

export const SCORE_HISTORY_DAYS = 7;
/** A shorter history says too little about how many posts arrive. */
const MIN_HISTORY_HOURS = 3;

/** The posts that arrived over `hours`, with each one's best score, best first. */
export type ScoreHistory = { hours: number; bestScores: number[] };

/** How many posts a day should be checked to fill a daily limit, given the
 *  share of checked posts that get a note. A note rate below `minNoteRate`
 *  counts as `minNoteRate`, so that a run of bad luck does not let almost
 *  every post through. */
export const postsPerDay = (dailyLimit: number, noteRate: number, minNoteRate: number) => dailyLimit / Math.max(noteRate, minNoteRate);

/** The score a post must reach to be checked, or null while the history is
 *  too short to tell. 0 when fewer posts arrive than the limit could take. */
export function viewsThreshold(history: ScoreHistory, wantedPerDay: number): number | null {
  if (history.hours < MIN_HISTORY_HOURS) return null;
  const wantedInHistory = Math.max(1, Math.round((wantedPerDay * history.hours) / 24));
  return history.bestScores[wantedInHistory - 1] ?? 0;
}
