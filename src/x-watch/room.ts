/**
 * The rules of cn-x-watch that need no database or X (GOO-851): how many new
 * posts may get a Claude now, and which ones. main.ts feeds them what it read.
 *
 * Until X admits the account, it writes test notes. X scores each one with its
 * evaluator and admits a writer whose last 50 test notes score well enough
 * (TEST_NOTES_FOR_ADMISSION). So the writer stops at 50 test notes and waits.
 *
 * Once admitted, a post gets a Claude only while the notes that are waiting
 * for Claude or for submission do not fill the room X leaves the account, as
 * the first account's X run does since GOO-839. The room is the writing limit
 * minus the notes submitted in the last 24 hours. X lets a new writer submit
 * 10 notes a day for its first 20 notes, and later sets the limit from its
 * hit rate, which we cannot see in advance. So the limit starts at 10, and
 * every accepted note that reaches it raises it by one, which lets one more
 * post through to test whether X now allows more. When X refuses a note for
 * the daily limit, the limit becomes the number of notes of the last 24 hours,
 * and nothing is submitted or checked for LIMIT_COOLDOWN_MS.
 */

import { isPossiblySensitive, type Post } from "../api/fetchEligiblePosts";

export const TEST_NOTES_FOR_ADMISSION = 50;
export const NEW_WRITER_DAILY_LIMIT = 10;
/** The first account's capacity waits this long after a refusal too
 *  (migration 100). */
export const LIMIT_COOLDOWN_MS = 95 * 60_000;

export type WriterState =
  | { kind: "testing"; testNotesSubmitted: number }
  | { kind: "admitted"; writingLimit: number; submittedLast24h: number; limitHitAt: Date | null };

/** Whether X refused a note for the daily limit too recently to try again. */
export function inLimitCooldown(state: WriterState, now: Date): boolean {
  return state.kind === "admitted" && state.limitHitAt !== null && now.getTime() - state.limitHitAt.getTime() < LIMIT_COOLDOWN_MS;
}

/** How many more posts may get a Claude now. `openNotes` counts the account's
 *  posts that wait for a Claude or whose note waits to be submitted. */
export function roomForChecks(state: WriterState, openNotes: number, now: Date): number {
  if (inLimitCooldown(state, now)) return 0;
  const room = state.kind === "testing"
    ? TEST_NOTES_FOR_ADMISSION - state.testNotesSubmitted - openNotes
    : state.writingLimit - state.submittedLast24h - openNotes;
  return Math.max(0, room);
}

/** The writing limit after X accepted a note, with `submittedLast24h`
 *  counting that note. */
export const limitAfterSuccess = (writingLimit: number, submittedLast24h: number) => Math.max(writingLimit, submittedLast24h + 1);

/** The newest feed posts that this account never handled, at most `room`.
 *  Posts X marked as possibly sensitive are left out, as in the X run. A
 *  fresh post is worth the most, because its views are still to come. */
export function pickNewPosts(posts: Post[], handledTweetIds: Set<string>, room: number): Post[] {
  if (room <= 0) return [];
  const unique = new Map(posts.map((post) => [post.id, post]));
  return [...unique.values()]
    .filter((post) => !handledTweetIds.has(post.id) && !isPossiblySensitive(post))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, room);
}
