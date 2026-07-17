import type { NoteRow } from "./types";

/** Net community score used to promote/swap notes within a claim: how many more
 *  people found it helpful than not. "Somewhat helpful" is deliberately ignored. */
const netScore = (n: NoteRow) => n.helpful_count - n.not_helpful_count;

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

/** Order the notes of one claim: the highest net score is promoted to the top
 *  (shown as the primary), the rest nest beneath it. The original AI note holds
 *  the top on ties (an improvement must strictly beat it to swap up), then older
 *  notes win. Re-evaluated live, so promotion swaps in both directions as votes
 *  move. */
export const byPromotion = (a: NoteRow, b: NoteRow) =>
  netScore(b) - netScore(a) ||
  Number(!!a.author_id) - Number(!!b.author_id) ||
  a.created_at.localeCompare(b.created_at);
