import { noteTally, probabilityHelpful } from "./noteBelief";
import type { NoteRow } from "./types";
import type { Vote } from "./votes";

/** Vote tallies are hidden until the viewer has voted (no anchoring on the
 *  crowd) — but once an item has been up this long, the tally is public
 *  record and shows to everyone. */
export const TALLY_REVEAL_AFTER_DAYS = 7;

export const tallyVisible = (myVote: Vote | undefined, createdAt: string) =>
  myVote !== undefined ||
  Date.now() - new Date(createdAt).getTime() > TALLY_REVEAL_AFTER_DAYS * 86_400_000;

/** Notes get one extra reveal on top of that: once a note is *rated*, its counts
 *  show to everyone straight away. Anchoring is only a worry while the outcome is
 *  still open — after that the tally is the result, and hiding it just makes a
 *  settled note look unread. Takes the already-computed status rather than
 *  recomputing it (each call is a continued-fraction evaluation). */
export const noteTallyVisible = (status: NoteStatus, myVote: Vote | undefined, createdAt: string) =>
  status !== "needs_ratings" || tallyVisible(myVote, createdAt);

export const totalVotes = (n: NoteRow) =>
  n.helpful_count + n.somewhat_helpful_count + n.not_helpful_count;

/** A note is rated once the crowd's estimate that it ends up helpful is decisive.
 *  This one predicate drives three things that used to be decided separately: the
 *  badge on the card, which section of the feed the note lands in, and which side
 *  of a frozen donation pair pays out. (Replaces the old ">=5 ratings and a
 *  net-positive weighted score" rule.)
 *
 *  The two thresholds bracket the tallies Jim named (2026-07-21), with margin
 *  either side:
 *    helpful   — above p(2 Helpful) = 0.746, at or below p(2H + 1 Somewhat) = 0.808
 *    unhelpful — below p(1 Not helpful) = 0.235, at or above p(2 Not helpful) = 0.156
 *  So 2 Helpful votes are not enough on their own but 2H + 1 Somewhat is, and one
 *  Not-helpful vote is not enough but two are. */
const RATED_HELPFUL_AT_P = 0.78;
const RATED_NOT_HELPFUL_AT_P = 0.2;
/** Community-Notes-style rating state: the note header badge, the feed section,
 *  and (for donations) which side of every frozen pair pays out. */
export type NoteStatus = "helpful" | "not_helpful" | "needs_ratings";

/** Stable content order for the notes on one claim: originals before their
 *  improvements, then oldest first — no vote-based reshuffling (main's feed
 *  froze ranking per page load for the same reason). */
export const originalsFirst = (a: NoteRow, b: NoteRow) =>
  Number(!!a.improved_from_note_id) - Number(!!b.improved_from_note_id) ||
  a.created_at.localeCompare(b.created_at);

export function noteStatus(note: NoteRow): NoteStatus {
  // No explicit quorum: the thresholds above already sit outside the reach of any
  // single vote (1H = 0.577, 1S = 0.469, 1U = 0.235), so one voter cannot rate a
  // note alone.
  const p = probabilityHelpful(noteTally(note));
  if (p >= RATED_HELPFUL_AT_P) return "helpful";
  if (p <= RATED_NOT_HELPFUL_AT_P) return "not_helpful";
  return "needs_ratings";
}
