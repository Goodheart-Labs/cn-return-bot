import { VOTE_VALUES } from "../../../dashboard-shared/Ratings";
import { noteTally, probabilityHelpful, withVote, type VoteTally } from "../../../everything-shared/noteBelief";
import type { NoteRow } from "../../../everything-shared/types";
import type { Vote } from "../../../everything-shared/votes";

/** Outcome-contingent vote donations.
 *
 *  What a vote is worth rests on the latent-quality model in `noteBelief.ts`.
 *  Information genuinely runs out as θ is pinned down, so a vote's donation
 *  decays on its own. There is no decay parameter anywhere.
 *
 *  Amounts come from the Brier rule. That rule is proper, which means voting
 *  honestly maximises your expected donation. Unlike the log rule it is also
 *  bounded. Once the crowd has converged and p stops moving, the payout goes to
 *  zero on both sides. A late vote is therefore a low-stakes click rather than a
 *  big bet at long odds.
 *
 *  Every amount is lifted by a base, which is the stake still on the table. That
 *  is the worst score drop any vote could suffer from the current position. So
 *  the smallest number on the card is the tip, and the whole card shrinks as the
 *  crowd converges. The base stays incentive-neutral because it depends only on
 *  the tally you walked into, never on how you vote.
 *
 *  Derivation, tuning and the rejected alternatives:
 *  src/scripts_jim/2026_07_21_donation_decay/RESULTS.md
 */

/** Jim raised this from 5 to 6.25 on 2026-07-21, which lifts every amount by
 *  25%. The tip is added on top rather than scaled, so changing this alone
 *  leaves the $0.25 floor where it is. */
const DOLLARS_PER_SCORE_UNIT = 6.25;
/** The floor under every displayed amount, so voting on a fully converged note
 *  still pays for the click. The whole card decays towards this value. */
const PARTICIPATION_TIP = 0.25;

export interface DonationPair {
  ifHelpful: number;
  ifNotHelpful: number;
}

const roundCents = (x: number) => Math.round(x * 100) / 100;

/** The two Brier scores for a belief p. The first is the score if the note
 *  settles helpful and the second is the score if it settles not helpful. The
 *  rule is proper and bounded. Being bounded is what lets both sides decay to
 *  nothing. */
const brierScores = (p: number): [number, number] => [1 - (1 - p) ** 2, 1 - p ** 2];

/** The tally a fresh vote is priced against. It is the note's tally with the
 *  voter's own standing vote taken out, because voting again replaces that vote
 *  rather than adding to it. */
export function priorTally(note: NoteRow, myVote: Vote | undefined): VoteTally {
  const tally = noteTally(note);
  return {
    helpful: Math.max(0, tally.helpful - (myVote === 1 ? 1 : 0)),
    somewhatHelpful: Math.max(0, tally.somewhatHelpful - (myVote === 0 ? 1 : 0)),
    notHelpful: Math.max(0, tally.notHelpful - (myVote === -1 ? 1 : 0)),
  };
}

/** The stake still on the table. This is the largest score drop anyone could
 *  suffer by voting from this position, and it is the base that every amount is
 *  lifted by. It depends only on the tally and never on how you vote, which is
 *  what keeps the base incentive-neutral. */
function stakeOnTheTable(tally: VoteTally): number {
  const before = brierScores(probabilityHelpful(tally));
  let worst = 0;
  for (const vote of VOTE_VALUES) {
    const after = brierScores(probabilityHelpful(withVote(tally, vote)));
    worst = Math.max(worst, before[0] - after[0], before[1] - after[1]);
  }
  return PARTICIPATION_TIP + DOLLARS_PER_SCORE_UNIT * worst;
}

/** The frozen donation pair for `vote` cast against the given prior tally. The
 *  first amount is donated if the note settles rated helpful. The second is
 *  donated if it settles rated not helpful. */
export function donationPair(tally: VoteTally, vote: Vote): DonationPair {
  const before = brierScores(probabilityHelpful(tally));
  const after = brierScores(probabilityHelpful(withVote(tally, vote)));
  const base = stakeOnTheTable(tally);
  return {
    ifHelpful: roundCents(base + DOLLARS_PER_SCORE_UNIT * (after[0] - before[0])),
    ifNotHelpful: roundCents(base + DOLLARS_PER_SCORE_UNIT * (after[1] - before[1])),
  };
}
