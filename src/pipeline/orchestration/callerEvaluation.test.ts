import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { Post } from "../../api/fetchEligiblePosts";
import * as evaluation from "../score/noteEvaluationFilter";
import { evaluateOnCallerIfMissing } from "./callerEvaluation";
import { CORRECTION_STATUS, type TweetComputeOutput } from "./processTweet";

const post = { id: "123", text: "The post" } as Post;
const NOTE = "A correction. https://example.com/source";

function serviceOutput(overrides: Partial<TweetComputeOutput> = {}): TweetComputeOutput {
  return {
    pipelineResult: null,
    outcome: "candidate",
    finalStage: "candidate",
    noteStatus: CORRECTION_STATUS,
    noteText: NOTE,
    scores: [],
    flatLog: { "eval.error": "Request failed with status code 403" },
    bot: { name: "simple-bot", config: { eval_submit_threshold: -3 } },
    ...overrides,
  };
}

describe("evaluateOnCallerIfMissing", () => {
  let evaluate: ReturnType<typeof spyOn<typeof evaluation, "getEvaluationScore">>;
  afterEach(() => evaluate?.mockRestore());

  test("a score below the threshold rejects a candidate, in the row and in the log", async () => {
    evaluate = spyOn(evaluation, "getEvaluationScore").mockResolvedValue({ score: -4 });
    const out = serviceOutput();
    await evaluateOnCallerIfMissing(post, out, false);
    expect(evaluate).toHaveBeenCalledWith("123", NOTE);
    expect(out).toMatchObject({
      outcome: "rejected",
      outcomeReason: "low_evaluation_score",
      finalStage: "evaluation",
      errorMessage: "eval score -4 below threshold -3",
      evaluationScore: -4,
    });
    expect(out.scores).toEqual([{ type: "evaluation", value: -4, metadata: { threshold: -3, passed: false } }]);
    expect(out.flatLog).toEqual({
      "eval.serviceError": "Request failed with status code 403",
      "eval.evaluatedOn": "caller",
      "eval.score": -4,
      "eval.shouldSubmit": false,
      "outcome.result": "rejected",
      "outcome.reason": "low_evaluation_score",
      "outcome.finalStage": "evaluation",
    });
  });

  test("a passing score keeps the candidate and records the score", async () => {
    evaluate = spyOn(evaluation, "getEvaluationScore").mockResolvedValue({ score: 0.2 });
    const out = serviceOutput();
    await evaluateOnCallerIfMissing(post, out, false);
    expect(out.outcome).toBe("candidate");
    expect(out.evaluationScore).toBe(0.2);
    expect(out.flatLog["eval.shouldSubmit"]).toBe(true);
  });

  test("an advisory post records a low score without rejecting", async () => {
    evaluate = spyOn(evaluation, "getEvaluationScore").mockResolvedValue({ score: -9 });
    const out = serviceOutput();
    await evaluateOnCallerIfMissing(post, out, true);
    expect(out.outcome).toBe("candidate");
    expect(out.evaluationScore).toBe(-9);
  });

  test("a second failure records the caller's error and keeps the candidate", async () => {
    evaluate = spyOn(evaluation, "getEvaluationScore").mockResolvedValue({ error: "timeout" });
    const out = serviceOutput();
    await evaluateOnCallerIfMissing(post, out, false);
    expect(out.outcome).toBe("candidate");
    expect(out.evaluationScore).toBeUndefined();
    expect(out.flatLog["eval.error"]).toBe("timeout");
    expect(out.flatLog["eval.serviceError"]).toBe("Request failed with status code 403");
  });

  test("a note rejected earlier gets a score but keeps its rejection", async () => {
    evaluate = spyOn(evaluation, "getEvaluationScore").mockResolvedValue({ score: -5 });
    const out = serviceOutput({ outcome: "rejected", outcomeReason: "check_failed", finalStage: "check" });
    await evaluateOnCallerIfMissing(post, out, false);
    expect(out.outcomeReason).toBe("check_failed");
    expect(out.evaluationScore).toBe(-5);
  });

  test("does nothing when the service scored or no correction was written", async () => {
    evaluate = spyOn(evaluation, "getEvaluationScore").mockResolvedValue({ score: 1 });
    await evaluateOnCallerIfMissing(post, serviceOutput({ evaluationScore: 0.5 }), false);
    await evaluateOnCallerIfMissing(post, serviceOutput({ outcome: "rejected", noteStatus: "NO CORRECTION NEEDED", noteText: "" }), false);
    expect(evaluate).not.toHaveBeenCalled();
  });
});
