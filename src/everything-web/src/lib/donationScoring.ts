import { VOTE_VALUES } from "../../../dashboard-shared/Ratings";
import { noteTally, probabilityHelpful, withVote, type VoteTally } from "../../../everything-shared/noteBelief";
import type { NoteRow } from "../../../everything-shared/types";
import type { Vote } from "../../../everything-shared/votes";

/** Outcome-contingent vote donations.
 *
 *  What a vote is worth rests on the latent-quality model in `noteBelief.ts`:
 *  because information genuinely runs out as θ is pinned down, a vote's donation
 *  decays on its own. There is no decay parameter anywhere.
 *
 *  Pricing — the Brier rule, which is proper (honesty maximises your expected
 *  donation) and, unlike the log rule, *bounded*: once the crowd converges and p
 *  stops moving, the payout goes to zero on BOTH sides, so a late vote is a
 *  low-stakes click rather than a big bet at long odds.
 *
 *  The base is the stake still on the table — exactly the worst score drop any
 *  vote could suffer from here — so the smallest number on the card is the tip
 *  and the whole card shrinks as the crowd converges. It stays incentive-neutral
 *  because it depends only on the tally you walked into, never on how you vote.
 *
 *  Derivation, tuning and the rejected alternatives:
 *  src/scripts_jim/2026_07_21_donation_decay/RESULTS.md
 */

/** Raised 5 -> 6.25 (Jim, 2026-07-21): lifts every amount 25%. The tip is an
 *  additive term, so scaling this alone leaves the $0.25 floor where it is. */
const DOLLARS_PER_SCORE_UNIT = 6.25;
/** Floor on every displayed amount, so a fully converged note still pays for the
 *  click. Also what the whole card decays towards. */
const PARTICIPATION_TIP = 0.25;

export interface DonationPair {
  ifHelpful: number;
  ifNotHelpful: number;
}

const roundCents = (x: number) => Math.round(x * 100) / 100;

/** Brier scores as [if the note settles Helpful, if it settles Not helpful].
 *  Proper, and bounded — which is what lets both sides decay to nothing. */
const brierScores = (p: number): [number, number] => [1 - (1 - p) ** 2, 1 - p ** 2];

/** The tally a fresh vote is priced against: the note's, minus the voter's own
 *  standing vote (a re-vote replaces it rather than adding to it). */
export function priorTally(note: NoteRow, myVote: Vote | undefined): VoteTally {
  const tally = noteTally(note);
  return {
    helpful: Math.max(0, tally.helpful - (myVote === 1 ? 1 : 0)),
    somewhatHelpful: Math.max(0, tally.somewhatHelpful - (myVote === 0 ? 1 : 0)),
    notHelpful: Math.max(0, tally.notHelpful - (myVote === -1 ? 1 : 0)),
  };
}

/** The stake still on the table: the largest score drop anyone could suffer
 *  voting from this position, and therefore the base every amount is lifted by.
 *  Depends only on the tally, never on how you vote — which is what keeps the
 *  base incentive-neutral. */
function stakeOnTheTable(tally: VoteTally): number {
  const before = brierScores(probabilityHelpful(tally));
  let worst = 0;
  for (const vote of VOTE_VALUES) {
    const after = brierScores(probabilityHelpful(withVote(tally, vote)));
    worst = Math.max(worst, before[0] - after[0], before[1] - after[1]);
  }
  return PARTICIPATION_TIP + DOLLARS_PER_SCORE_UNIT * worst;
}

/** The frozen donation pair for `vote` cast against the given prior tally:
 *  (donated if the note settles rated helpful, donated if not helpful). */
export function donationPair(tally: VoteTally, vote: Vote): DonationPair {
  const before = brierScores(probabilityHelpful(tally));
  const after = brierScores(probabilityHelpful(withVote(tally, vote)));
  const base = stakeOnTheTable(tally);
  return {
    ifHelpful: roundCents(base + DOLLARS_PER_SCORE_UNIT * (after[0] - before[0])),
    ifNotHelpful: roundCents(base + DOLLARS_PER_SCORE_UNIT * (after[1] - before[1])),
  };
}
