/**
 * The rules of cn-x-watch that need no database or X (GOO-851): how many new
 * posts may get a Claude now. Which ones is pick.ts. main.ts feeds them what
 * it read.
 *
 * Until X admits the account, it writes test notes. X scores each one with its
 * evaluator and admits a writer whose last 50 test notes score well enough
 * (TEST_NOTES_FOR_ADMISSION). Jim looks at the notes and their scores in
 * batches, so the writer writes only as many test notes as he allowed: the
 * allowance is a total in pipeline_state (`<account>:test_note_allowance`),
 * which `bun run x-watch-allow-test-notes <n>` raises by n. It starts at 0, so
 * a fresh account writes nothing until someone allows a first batch.
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

export const TEST_NOTES_FOR_ADMISSION = 50;
export const NEW_WRITER_DAILY_LIMIT = 10;
/** The first account's capacity waits this long after a refusal too
 *  (migration 100). */
export const LIMIT_COOLDOWN_MS = 95 * 60_000;

export type WriterState =
  | { kind: "testing"; testNotesSubmitted: number; testNoteAllowance: number }
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
    ? state.testNoteAllowance - state.testNotesSubmitted - openNotes
    : state.writingLimit - state.submittedLast24h - openNotes;
  return Math.max(0, room);
}

/** The writing limit after X accepted a note, with `submittedLast24h`
 *  counting that note. */
export const limitAfterSuccess = (writingLimit: number, submittedLast24h: number) => Math.max(writingLimit, submittedLast24h + 1);

/** The notes a day the account may write: the estimate once admitted, and a
 *  new writer's limit while it writes test notes. */
export const dailyLimit = (state: WriterState) => (state.kind === "admitted" ? state.writingLimit : NEW_WRITER_DAILY_LIMIT);
