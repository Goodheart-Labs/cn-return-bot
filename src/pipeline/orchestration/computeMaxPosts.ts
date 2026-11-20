import type { SubmissionCapacity } from "../capacity/submissionReserve";

export const MAX_POSTS_CAP = 20;
/** We check a few more tweets than the room needs, because the share of checks
 *  that end in a note varies from run to run. */
const SAFETY_MULTIPLIER = 1.25;
/** Below this many checks in the sample, the share of checks that end in a
 *  note says too little, and the run checks the full batch. */
const MIN_CHECKS_FOR_RATE = 20;

/** The X bot's checks of a recent window: how many tweets it checked, and how
 *  many of those ended in a note that was submitted or waits to be. */
export type RecentChecks = { checked: number; noted: number };

/**
 * How many tweets this run checks (GOO-839). It checks as many as it takes to
 * fill the room X has left, and none when the room is full. Until 2026-09-15
 * the X run worked this way. Then every run checked 20 tweets whenever X had
 * any room, so the notes beyond the room waited in the note queue for hours.
 *
 * The room is the capacity function's `remaining` (migration 100): the
 * writing limit minus the notes we submitted in the last 24 hours. The limit
 * is how many notes we had submitted in the 24 hours before X last refused
 * one. Without a recent refusal it is one more than we ever had in 24 hours,
 * so the bot keeps trying one note above its record. The notes already
 * waiting in the queue fill the room first. A cooldown probe has room for
 * exactly one note, which a waiting note fills just as well as a new one.
 */
export function computeMaxPosts(capacity: SubmissionCapacity, recent: RecentChecks, queuedReady: number): number {
  if (!capacity.canSubmit || capacity.signalQueued > 0) return 0;
  const room = capacity.probe ? 1 : capacity.remaining;
  if (room === null) return MAX_POSTS_CAP;
  const roomForNewNotes = room - queuedReady;
  if (roomForNewNotes <= 0) return 0;
  if (recent.checked < MIN_CHECKS_FOR_RATE || recent.noted === 0) return MAX_POSTS_CAP;
  const checksPerNote = recent.checked / recent.noted;
  return Math.min(MAX_POSTS_CAP, Math.ceil(roomForNewNotes * checksPerNote * SAFETY_MULTIPLIER));
}
