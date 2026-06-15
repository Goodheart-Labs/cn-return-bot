/**
 * Ground-truth label for a pipeline run, from simple-bot's own decision.
 *
 * The filter we're evaluating decides "does this tweet need a note?" BEFORE the
 * expensive pipeline runs. Ground truth = what simple-bot ultimately decided:
 *
 *  - "wants_note": simple-bot WROTE a note (the writer produced a correction).
 *    This is the positive class. It includes runs the later gates blocked —
 *    low_evaluation_score (score too low to submit), check_failed (verifier),
 *    submit-time rejections (submit_error / daily_limit / tweet_deleted /
 *    ineligible) — because in all of those the bot DID decide a note was needed.
 *    Per Jim: "attempted submit but score too low counts as wants to write note".
 *
 *  - "no_note": simple-bot decided no correction was needed
 *    (outcome=rejected, reason=no_correction_needed). The negative class.
 *
 *  - "exclude": errors / non-decisions (outcome=failed/in_progress/filtered).
 *    These never represent a clean note decision and are dropped from the set.
 */
export type RunLabel = "wants_note" | "no_note" | "exclude";

export function labelRun(outcome: string, outcomeReason: string | null): RunLabel {
  if (outcome === "failed" || outcome === "in_progress" || outcome === "filtered") {
    return "exclude";
  }
  if (outcome === "rejected" && outcomeReason === "no_correction_needed") {
    return "no_note";
  }
  return "wants_note";
}

export function tweetUrl(tweetId: string): string {
  return `https://x.com/i/status/${tweetId}`;
}
