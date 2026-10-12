import { regularizedIncompleteBeta } from "./incompleteBeta";
import type { NoteRow } from "./types";
import type { Vote } from "./votes";

/** How likely is a note to end up rated helpful?
 *
 *  Every note has a hidden quality θ. That is the share of all raters who would call
 *  the note helpful. Each voter is one draw from that pool. With a Beta prior the
 *  update is then plain counting. The note settles as rated helpful exactly when θ
 *  clears X's bar for a currently rated helpful note. Once θ is pinned down, the
 *  uncertainty that is left cannot be reduced any further. That is why a late vote
 *  carries so little information.
 *
 *  This lives in its own module because three unrelated things need it now. They are
 *  pricing a donation, settling one, and ranking the feed.
 *
 *  The derivation is in src/scripts_jim/2026_07_21_donation_decay/RESULTS.md.
 */

/** The Beta prior on θ. Its total weight is 5, so it counts for about five imaginary
 *  votes. It is skewed so that P(θ > CRH_THRESHOLD) is 0.35, which is our base rate
 *  for a note settling helpful. */
const PRIOR_A = 1.6806912990301406;
const PRIOR_B = 3.3193087009698594;
/** X's bar for a currently rated helpful note, on X's own rating scale where helpful
 *  is 1.0, somewhat helpful is 0.5 and not helpful is 0.0. This is an approximation.
 *  X applies 0.40 to the note intercept its matrix factorization produces, not to a
 *  plain average, so treating it as a bar on θ is a modelling liberty. We still
 *  prefer a real constant to one fitted to our own base rate. The alternative was to
 *  solve for the bar from our 35% base rate, and that put it above 0.5 for no
 *  principled reason. */
const CRH_THRESHOLD = 0.4;
/** A Somewhat vote adds half a Helpful vote and adds nothing on the other side, so it
 *  can only ever count in a note's favour. Jim decided this on 2026-07-21. There is a
 *  consequence we accept on purpose. Somewhat is never evidence against a note, so
 *  Somewhat votes on their own can rate a note helpful. At the thresholds in
 *  noteScore.ts it takes five of them. */
const SOMEWHAT_TO_HELPFUL = 0.5;

export interface VoteTally {
  helpful: number;
  somewhatHelpful: number;
  notHelpful: number;
}

/** The probability that the note settles as rated helpful. It is the mass of the Beta
 *  posterior that sits above the bar. */
export function probabilityHelpful(tally: VoteTally): number {
  const a = PRIOR_A + tally.helpful + SOMEWHAT_TO_HELPFUL * tally.somewhatHelpful;
  const b = PRIOR_B + tally.notHelpful;
  return 1 - regularizedIncompleteBeta(a, b, CRH_THRESHOLD);
}

export const withVote = (tally: VoteTally, vote: Vote): VoteTally => ({
  helpful: tally.helpful + (vote === 1 ? 1 : 0),
  somewhatHelpful: tally.somewhatHelpful + (vote === 0 ? 1 : 0),
  notHelpful: tally.notHelpful + (vote === -1 ? 1 : 0),
});

/** The columns the tally is computed from. Callers that never hold a full
 *  NoteRow, such as the noted-page counts sync, can select just these. */
export type NoteTallyFields = Pick<NoteRow, "helpful_count" | "somewhat_helpful_count" | "not_helpful_count" | "author_id">;

/** The note's public tally with the author's own vote taken out. A database trigger
 *  casts that vote automatically, so it is entirely predictable and carries no
 *  information. This is an approximation, because it assumes the author has not
 *  since changed that vote away from helpful. */
export function noteTally(note: NoteTallyFields): VoteTally {
  return {
    helpful: Math.max(0, note.helpful_count - (note.author_id ? 1 : 0)),
    somewhatHelpful: note.somewhat_helpful_count,
    notHelpful: note.not_helpful_count,
  };
}

/** Where the note's estimate would land if one more `vote` came in. */
export const probabilityHelpfulAfter = (note: NoteRow, vote: Vote): number =>
  probabilityHelpful(withVote(noteTally(note), vote));
