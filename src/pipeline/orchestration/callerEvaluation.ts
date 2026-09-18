import { DEFAULT_CONFIG } from "../ab-testing/botConfig";
import { getEvaluationScore } from "../score/noteEvaluationFilter";
import type { TweetComputeOutput } from "./processTweet";

type Evaluate = (postId: string, noteText: string) => Promise<{ score?: number; error?: string }>;

/** The machine that computes a tweet sits on a network X refuses for
 *  POST /2/evaluate_note (every call since 2026-09-09), while the caller,
 *  GitHub Actions, is accepted. When the service hands back a candidate note
 *  without a score, score it from here and apply the gate the service would
 *  have applied, so the run row and the submit decision look the same either
 *  way. A service that does score again makes this a no-op. */
export async function evaluateOnCallerIfMissing(
  output: TweetComputeOutput,
  postId: string,
  evaluate: Evaluate = getEvaluationScore,
): Promise<"skipped" | "scored" | "rejected" | "failed"> {
  if (output.outcome !== "candidate" || output.evaluationScore !== undefined || !output.noteText?.trim()) return "skipped";
  const result = await evaluate(postId, output.noteText);
  if (result.score === undefined) {
    output.flatLog["eval.callerError"] = result.error ?? "no score returned";
    return "failed";
  }
  const threshold = typeof output.flatLog["eval.threshold"] === "number"
    ? (output.flatLog["eval.threshold"] as number)
    : (DEFAULT_CONFIG.eval_submit_threshold ?? 0);
  const advisory = output.flatLog["eval.advisory"] === true;
  const shouldSubmit = result.score >= threshold;
  output.evaluationScore = result.score;
  output.scores.push({ type: "evaluation", value: result.score, metadata: { threshold, passed: shouldSubmit, evaluatedOn: "caller" } });
  if ("eval.error" in output.flatLog) {
    output.flatLog["eval.serviceError"] = output.flatLog["eval.error"];
    delete output.flatLog["eval.error"];
  }
  output.flatLog["eval.score"] = result.score;
  output.flatLog["eval.shouldSubmit"] = shouldSubmit;
  output.flatLog["eval.evaluatedOn"] = "caller";
  if (!shouldSubmit && !advisory) {
    output.outcome = "rejected";
    output.outcomeReason = "low_evaluation_score";
    output.finalStage = "evaluation";
    output.errorMessage = `eval score ${result.score} below threshold ${threshold}`;
    return "rejected";
  }
  return "scored";
}
