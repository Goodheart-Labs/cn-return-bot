import { describe, expect, test } from "bun:test";
import { evaluateOnCallerIfMissing } from "./callerEvaluation";
import type { TweetComputeOutput } from "./processTweet";

function output(overrides: Partial<TweetComputeOutput> = {}): TweetComputeOutput {
  return {
    pipelineResult: null, outcome: "candidate", finalStage: "candidate", noteText: "A note. https://example.org",
    scores: [], flatLog: { "eval.threshold": -3, "eval.advisory": false, "eval.error": "Request failed with status code 403" },
    bot: { name: "simple-bot" }, ...overrides,
  };
}

describe("evaluateOnCallerIfMissing", () => {
  test("skips when the service already scored, wrote no note, or did not produce a candidate", async () => {
    const calls: string[] = [];
    const evaluate = async (id: string) => { calls.push(id); return { score: 1 }; };
    expect(await evaluateOnCallerIfMissing(output({ evaluationScore: 0.4 }), "1", evaluate)).toBe("skipped");
    expect(await evaluateOnCallerIfMissing(output({ noteText: "" }), "1", evaluate)).toBe("skipped");
    expect(await evaluateOnCallerIfMissing(output({ outcome: "rejected" }), "1", evaluate)).toBe("skipped");
    expect(calls).toEqual([]);
  });

  test("a passing score is recorded exactly as the service would have recorded it", async () => {
    const out = output();
    const seen: Array<[string, string]> = [];
    expect(await evaluateOnCallerIfMissing(out, "42", async (id, text) => { seen.push([id, text]); return { score: 0.25 }; })).toBe("scored");
    expect(seen).toEqual([["42", "A note. https://example.org"]]);
    expect(out.outcome).toBe("candidate");
    expect(out.evaluationScore).toBe(0.25);
    expect(out.scores).toEqual([{ type: "evaluation", value: 0.25, metadata: { threshold: -3, passed: true, evaluatedOn: "caller" } }]);
    expect(out.flatLog).toMatchObject({ "eval.score": 0.25, "eval.shouldSubmit": true, "eval.evaluatedOn": "caller", "eval.serviceError": "Request failed with status code 403" });
    expect(out.flatLog).not.toHaveProperty("eval.error");
  });

  test("a score below the threshold rejects the note unless the post is advisory", async () => {
    const out = output();
    expect(await evaluateOnCallerIfMissing(out, "42", async () => ({ score: -4 }))).toBe("rejected");
    expect(out).toMatchObject({ outcome: "rejected", outcomeReason: "low_evaluation_score", finalStage: "evaluation", errorMessage: "eval score -4 below threshold -3" });
    const advisory = output({ flatLog: { "eval.threshold": -3, "eval.advisory": true } });
    expect(await evaluateOnCallerIfMissing(advisory, "42", async () => ({ score: -4 }))).toBe("scored");
    expect(advisory.outcome).toBe("candidate");
  });

  test("falls back to the default threshold and leaves the outcome alone when scoring fails again", async () => {
    const noThreshold = output({ flatLog: {} });
    expect(await evaluateOnCallerIfMissing(noThreshold, "42", async () => ({ score: 5 }))).toBe("scored");
    expect(noThreshold.scores[0]!.metadata).toMatchObject({ passed: true });
    const failing = output();
    expect(await evaluateOnCallerIfMissing(failing, "42", async () => ({ error: "boom" }))).toBe("failed");
    expect(failing.outcome).toBe("candidate");
    expect(failing.flatLog["eval.callerError"]).toBe("boom");
    expect(failing.evaluationScore).toBeUndefined();
  });
});
