import { regularizedIncompleteBeta } from "./incompleteBeta";
import type { NoteRow } from "./types";
import type { Vote } from "./votes";

/** How likely is a note to end up rated helpful?
 *
 *  Every note has a latent quality θ — the share of all raters who would call it
 *  helpful. Each voter is a draw from that pool, so a Beta prior makes updating
 *  literal counting, and the note settles rated helpful iff θ clears X's CRH bar.
 *  Once θ is pinned down the remaining uncertainty is irreducible, which is why a
 *  late vote carries so little information.
 *
 *  Its own module because three unrelated things now need it: pricing a donation,
 *  settling one, and ranking the feed.
 *
 *  Derivation: src/scripts_jim/2026_07_21_donation_decay/RESULTS.md
 */

/** Beta prior on θ. Total weight 5 (≈5 pseudo-votes), skewed so that
 *  P(θ > CRH_THRESHOLD) = 0.35, our base rate for a note settling helpful. */
const PRIOR_A = 1.6806912990301406;
const PRIOR_B = 3.3193087009698594;
/** X's CRH bar on its own 1.0 / 0.5 / 0.0 rating scale. Approximation: 0.40
 *  thresholds the matrix-factorization note intercept rather than a raw mean, so
 *  reading it as a bar on θ is a modelling liberty — but a real constant beats
 *  one fitted to our own base rate (the alternative was solving the bar from our
 *  35% base rate, which landed it above 0.5 for no principled reason). */
const CRH_THRESHOLD = 0.4;
/** A Somewhat vote adds half a Helpful vote and nothing on the other side, so it
 *  can only ever count *for* a note (Jim, 2026-07-21). Deliberate consequence:
 *  Somewhat is never evidence against, so enough Somewhat votes alone will rate a
 *  note helpful — 5 of them, at the thresholds in noteScore.ts. */
const SOMEWHAT_TO_HELPFUL = 0.5;

export interface VoteTally {
  helpful: number;
  somewhatHelpful: number;
  notHelpful: number;
}

/** P(the note settles rated Helpful) — the Beta posterior's mass above the bar. */
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

/** The note's public tally minus the author's trigger-cast self-vote — it is
 *  predictable, so it carries no information. (Approximation: assumes that
 *  self-vote is still "helpful".) */
export function noteTally(note: NoteRow): VoteTally {
  return {
    helpful: Math.max(0, note.helpful_count - (note.author_id ? 1 : 0)),
    somewhatHelpful: note.somewhat_helpful_count,
    notHelpful: note.not_helpful_count,
  };
}

/** Where the note's estimate would land if one more `vote` came in. */
export const probabilityHelpfulAfter = (note: NoteRow, vote: Vote): number =>
  probabilityHelpful(withVote(noteTally(note), vote));
