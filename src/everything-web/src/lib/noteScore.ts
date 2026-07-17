import type { NoteRow } from "./types";

export const totalVotes = (n: NoteRow) =>
  n.helpful_count + n.somewhat_helpful_count + n.not_helpful_count;

export const weight = (n: NoteRow) => n.helpful_count + 0.5 * n.somewhat_helpful_count;

/** Ratings needed before a note is judged helpful/not-helpful rather than
 *  "needs more ratings". */
export const MIN_RATINGS_TO_RATE = 5;

/** Nathan's spec: a note "locks in" as a real note at enough ratings with a
 *  net-positive weighted score; under that it's still a draft. */
export const isLocked = (n: NoteRow) =>
  totalVotes(n) >= MIN_RATINGS_TO_RATE && weight(n) > n.not_helpful_count;

/** Community-Notes-style rating state shown in the note header. */
export type NoteStatus = "helpful" | "not_helpful" | "needs_ratings";

export function noteStatus(n: NoteRow): NoteStatus {
  if (totalVotes(n) < MIN_RATINGS_TO_RATE) return "needs_ratings";
  return isLocked(n) ? "helpful" : "not_helpful";
}
