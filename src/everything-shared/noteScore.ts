import { noteTally, probabilityHelpful } from "./noteBelief";
import type { NoteRow } from "./types";
import type { Vote } from "./votes";

/** Vote tallies stay hidden until the viewer has voted. That way the crowd's
 *  counts cannot anchor the rating they are about to give. Once an item has been
 *  up this long the tally is public record, and it shows to everyone. */
export const TALLY_REVEAL_AFTER_DAYS = 7;

export const tallyVisible = (myVote: Vote | undefined, createdAt: string) =>
  myVote !== undefined ||
  Date.now() - new Date(createdAt).getTime() > TALLY_REVEAL_AFTER_DAYS * 86_400_000;

/** Notes get one extra reveal on top of that. Once a note is rated, its counts
 *  show to everyone straight away. Anchoring only matters while the outcome is
 *  still open. After that the tally is the result, and hiding it just makes a
 *  settled note look unread. This takes the already-computed status instead of
 *  working it out again, because working it out evaluates a continued fraction. */
export const noteTallyVisible = (status: NoteStatus, myVote: Vote | undefined, createdAt: string) =>
  status !== "needs_ratings" || tallyVisible(myVote, createdAt);

export const totalVotes = (n: NoteRow) =>
  n.helpful_count + n.somewhat_helpful_count + n.not_helpful_count;

/** A note is rated once the crowd's estimate that it ends up helpful is decisive.
 *  This one predicate drives three things that used to be decided separately. It
 *  picks the badge on the card. It picks which section of the feed the note lands
 *  in. It picks which side of a frozen donation pair pays out. It replaced the
 *  old rule of at least 5 ratings plus a net-positive weighted score.
 *
 *  The two thresholds bracket the tallies Jim named on 2026-07-21, with margin on
 *  either side. The helpful threshold sits above p for 2 Helpful votes, which is
 *  0.746, and at or below p for 2 Helpful plus 1 Somewhat, which is 0.808. The
 *  unhelpful threshold sits below p for 1 Not-helpful vote, which is 0.235, and
 *  at or above p for 2 Not-helpful votes, which is 0.156. So 2 Helpful votes are
 *  not enough on their own, but 2 Helpful plus 1 Somewhat is. One Not-helpful
 *  vote is not enough, but two are. */
const RATED_HELPFUL_AT_P = 0.78;
const RATED_NOT_HELPFUL_AT_P = 0.2;
/** A note's rating state, in the style of Community Notes. It sets the badge in
 *  the note header, the feed section the note appears in, and which side of every
 *  frozen donation pair pays out. */
export type NoteStatus = "helpful" | "not_helpful" | "needs_ratings";

/** Stable content order for the notes on one claim. Originals come before their
 *  improvements, and inside each group the oldest note comes first. Votes never
 *  reshuffle this order. The website's feed freezes its own ranking for a whole
 *  page load for the same reason: a card must not move under the reader. */
export const originalsFirst = (a: NoteRow, b: NoteRow) =>
  Number(!!a.improved_from_note_id) - Number(!!b.improved_from_note_id) ||
  a.created_at.localeCompare(b.created_at);

export function noteStatus(note: NoteRow): NoteStatus {
  // There is no explicit quorum. A single vote cannot reach either threshold on
  // its own: one Helpful vote gives p = 0.577, one Somewhat gives 0.469 and one
  // Not-helpful gives 0.235. So one voter can never rate a note alone.
  const p = probabilityHelpful(noteTally(note));
  if (p >= RATED_HELPFUL_AT_P) return "helpful";
  if (p <= RATED_NOT_HELPFUL_AT_P) return "not_helpful";
  return "needs_ratings";
}
