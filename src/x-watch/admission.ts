/**
 * Whether X has admitted cn-x-watch's account as an AI Note Writer, and how
 * its test notes score (GOO-851).
 *
 * A new writer may only work in test mode. X's evaluator scores each test
 * note, and X's rule (communitynotes repository, documentation/api/overview.md,
 * read on 2026-11-23) is that among the writer's 50 most recent test notes
 *   - at least 30% must score high on ClaimOpinion,
 *   - at most 30% may score low on ClaimOpinion, and
 *   - at least 95% must score high on UrlValidity.
 * ClaimOpinion is X's model of whether a note addresses the post's claims
 * without opinion. UrlValidity checks that every link in the note answers.
 * Writers that pass are admitted by a random draw, because the program is
 * still a pilot, and X sends the account an email. X has no endpoint that
 * says whether a writer is admitted, so the daemon asks for the feed outside
 * test mode, which X refuses with a 403 until then.
 */

import { walkEligiblePages } from "../api/fetchEligiblePosts";
import type { WrittenNote } from "../api/fetchNotesWritten";

const NOT_ADMITTED_MESSAGE = "must earn admission";

/** One page of one post outside test mode. The WSDM Cup account takes part in
 *  X's contest, whose feed X serves only without a post_selection: outside test
 *  mode X refuses one with a 400 (since 2026-11-23, when it admitted the
 *  account). */
export async function isAdmitted(): Promise<boolean> {
  try {
    await walkEligiblePages(undefined, 1, false).next();
    return true;
  } catch (err) {
    const response = (err as { response?: { status?: number; data?: unknown } }).response;
    if (response?.status === 403 && JSON.stringify(response.data ?? "").includes(NOT_ADMITTED_MESSAGE)) return false;
    throw err;
  }
}

export type AdmissionSummary = {
  notes: number;
  /** Notes the evaluator has not scored yet. */
  unscored: number;
  claimOpinionHigh: number;
  claimOpinionLow: number;
  urlValidityHigh: number;
  meetsCriteria: boolean;
};

const MIN_CLAIM_OPINION_HIGH_SHARE = 0.3;
const MAX_CLAIM_OPINION_LOW_SHARE = 0.3;
const MIN_URL_VALIDITY_HIGH_SHARE = 0.95;

/** X writes the buckets capitalised, for example "High", while its guide
 *  writes them in lowercase, so they are compared in lowercase. */
const bucket = (note: WrittenNote, evaluator: string) =>
  note.test_result?.evaluation_outcome?.find((outcome) => outcome.evaluator_type === evaluator)?.evaluator_score_bucket.toLowerCase();

/** X's admission rule applied to the given test notes, which should be the 50
 *  most recent. Shares are taken over all of them, so an unscored note
 *  counts as neither high nor low. */
export function summariseTestNotes(notes: WrittenNote[]): AdmissionSummary {
  const countBucket = (evaluator: string, value: string) => notes.filter((note) => bucket(note, evaluator) === value).length;
  const claimOpinionHigh = countBucket("ClaimOpinion", "high");
  const claimOpinionLow = countBucket("ClaimOpinion", "low");
  const urlValidityHigh = countBucket("UrlValidity", "high");
  const total = notes.length;
  return {
    notes: total,
    unscored: notes.filter((note) => !note.test_result?.evaluation_outcome?.length).length,
    claimOpinionHigh,
    claimOpinionLow,
    urlValidityHigh,
    meetsCriteria: total > 0
      && claimOpinionHigh >= MIN_CLAIM_OPINION_HIGH_SHARE * total
      && claimOpinionLow <= MAX_CLAIM_OPINION_LOW_SHARE * total
      && urlValidityHigh >= MIN_URL_VALIDITY_HIGH_SHARE * total,
  };
}

export function describeSummary(summary: AdmissionSummary): string {
  const { notes, unscored, claimOpinionHigh, claimOpinionLow, urlValidityHigh, meetsCriteria } = summary;
  return `Of the last ${notes} test notes, ${claimOpinionHigh} score high on ClaimOpinion (30% needed), ${claimOpinionLow} low (at most 30%), `
    + `and ${urlValidityHigh} high on UrlValidity (95% needed). ${unscored} are not scored yet. `
    + (meetsCriteria ? "That meets X's admission criteria." : "That does not meet X's admission criteria yet.");
}
