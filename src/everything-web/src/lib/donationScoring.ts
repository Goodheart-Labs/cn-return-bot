import type { NoteRow } from "./types";
import type { Vote } from "./votes";

/** Outcome-contingent vote donations via the log market scoring rule.
 *
 *  Each note carries a running log-odds estimate of settling "rated helpful",
 *  derived from its vote tally. A vote moves the estimate, and its donation is
 *  the value of the information it added toward the realized outcome, plus a
 *  flat base — so early consensus-shifting votes earn more than late pile-ons,
 *  and the pair shown at vote time is frozen (later votes never change it).
 *
 *  Parameters are preset S2 of the grid search in
 *  src/scripts_jim/2026_07_17_donation_scoring/RESULTS.md. */
const PRIOR_P_HELPFUL = 0.35;
const LOG_ODDS_PER_VOTE: Record<Vote, number> = { 1: 0.4, 0: 0, [-1]: -0.52 };
const DOLLARS_PER_NAT = 5;
const BASE_DONATION_USD = 1.5;
/** Floor on the score term — caps how far below base a wrong vote can end. */
const SCORE_DROP_CLIP = 0.24;

export interface DonationPair {
  ifHelpful: number;
  ifNotHelpful: number;
}

/** A cast vote's id plus its frozen donation pair (null pair-carrier = retract
 *  or a vote that mints no donation, e.g. on your own note). */
export interface VoteCast {
  voteId: string;
  pair: DonationPair;
}

interface VoteTally {
  helpful: number;
  somewhatHelpful: number;
  notHelpful: number;
}

const softplus = (x: number) => Math.log1p(Math.exp(-Math.abs(x))) + Math.max(x, 0);
const logit = (p: number) => Math.log(p / (1 - p));
const roundCents = (x: number) => Math.round(x * 100) / 100;

const tallyLogOdds = (tally: VoteTally) =>
  logit(PRIOR_P_HELPFUL) +
  LOG_ODDS_PER_VOTE[1] * tally.helpful +
  LOG_ODDS_PER_VOTE[0] * tally.somewhatHelpful +
  LOG_ODDS_PER_VOTE[-1] * tally.notHelpful;

/** The prior tally for a fresh vote on `note`: the live counters minus the
 *  voter's own standing vote (a re-vote replaces it) and minus the author's
 *  trigger-cast self-vote — it's predictable, so it carries no information.
 *  (Approximation: assumes the author's self-vote is still "helpful".) */
export function priorTally(note: NoteRow, myVote: Vote | undefined): VoteTally {
  const tally = {
    helpful: note.helpful_count - (myVote === 1 ? 1 : 0) - (note.author_id ? 1 : 0),
    somewhatHelpful: note.somewhat_helpful_count - (myVote === 0 ? 1 : 0),
    notHelpful: note.not_helpful_count - (myVote === -1 ? 1 : 0),
  };
  return {
    helpful: Math.max(0, tally.helpful),
    somewhatHelpful: Math.max(0, tally.somewhatHelpful),
    notHelpful: Math.max(0, tally.notHelpful),
  };
}

/** The frozen donation pair for `vote` cast against the given prior tally:
 *  (donated if the note settles rated helpful, donated if not helpful). */
export function donationPair(tally: VoteTally, vote: Vote): DonationPair {
  const before = tallyLogOdds(tally);
  const after = before + LOG_ODDS_PER_VOTE[vote];
  const scoreIfHelpful = softplus(-before) - softplus(-after); // Δ ln p
  const scoreIfNotHelpful = softplus(before) - softplus(after); // Δ ln (1−p)
  return {
    ifHelpful: roundCents(BASE_DONATION_USD + DOLLARS_PER_NAT * Math.max(scoreIfHelpful, -SCORE_DROP_CLIP)),
    ifNotHelpful: roundCents(BASE_DONATION_USD + DOLLARS_PER_NAT * Math.max(scoreIfNotHelpful, -SCORE_DROP_CLIP)),
  };
}
