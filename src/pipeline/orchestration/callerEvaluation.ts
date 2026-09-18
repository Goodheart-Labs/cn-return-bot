import type { Post } from "../../api/fetchEligiblePosts";
import { getEvaluationScore } from "../score/noteEvaluationFilter";
import { CORRECTION_STATUS, type TweetComputeOutput } from "./processTweet";

/**
 * Scores a note from the caller when the claim-check service could not, and
 * applies the eval gate the service would have applied. The output is changed
 * in place: the score, its log entries, and a rejection when the score is
 * below the threshold.
 *
 * The service's X keys lack the Community Notes permission, so its
 * evaluate_note call has failed since 7 September 2026. The keys in GitHub
 * Actions work (GOO-185). The service keeps trying, so once it has the right
 * keys its own score comes back and this function does nothing.
 *
 * Every note the bot wrote as a correction is scored, so a note rejected
 * earlier still gets a score for later analysis. Only a candidate can be
 * rejected here. On advisory posts, which are the misinfo-monitoring ones, the
 * score is recorded but never rejects anything. When this call fails too, the
 * note is not rejected, because it may be good. The failure is counted
 * instead, and the scheduled run fails at its end (see countFailedEvaluations).
 */
export async function evaluateOnCallerIfMissing(post: Post, out: TweetComputeOutput, advisory: boolean): Promise<void> {
  if (out.evaluationScore !== undefined || out.noteStatus !== CORRECTION_STATUS || !out.noteText) return;
  const log = out.flatLog;
  // The service's error stays in the log under its own name, so a caller
  // success does not leave a stale error behind.
  if ("eval.error" in log) {
    log["eval.serviceError"] = log["eval.error"];
    delete log["eval.error"];
  }
  const threshold = (out.bot.config?.eval_submit_threshold as number | undefined) ?? 0;
  log["eval.evaluatedOn"] = "caller";

  const evaluation = await getEvaluationScore(post.id, out.noteText);
  if (evaluation.score === undefined) {
    log["eval.error"] = evaluation.error ?? "no score returned";
    return;
  }
  const { score } = evaluation;
  const shouldSubmit = score >= threshold;
  log["eval.score"] = score;
  log["eval.shouldSubmit"] = shouldSubmit;
  out.evaluationScore = score;
  out.scores.push({ type: "evaluation", value: score, metadata: { threshold, passed: shouldSubmit } });

  if (out.outcome !== "candidate" || shouldSubmit || advisory) return;
  out.outcome = "rejected";
  out.outcomeReason = "low_evaluation_score";
  out.finalStage = "evaluation";
  out.errorMessage = `eval score ${score} below threshold ${threshold}`;
  log["outcome.result"] = out.outcome;
  log["outcome.reason"] = out.outcomeReason;
  log["outcome.finalStage"] = out.finalStage;
}
