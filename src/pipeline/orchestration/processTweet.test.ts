import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Post } from "../../api/fetchEligiblePosts";
import { outcomeToResult } from "../../bots/types";
import { DEFAULT_CONFIG, withBotConfig } from "../ab-testing/botConfig";
import { withCostTracker } from "../cost-tracking/costTracker";
import * as botInput from "../input/createBotInput";
import { withMonitoringContext } from "../misinfo-monitoring/monitoringContext";
import * as prefilter from "../prefilter/noteNeededPrefilter";
import * as userMessage from "../prompts/input/userMessage";
import * as evaluation from "../score/noteEvaluationFilter";
import * as jsonLlm from "../utils/jsonLlmCall";
import { createTweetLog, withTweetLog } from "../utils/tweetLog";
import { withWarnings } from "../utils/warnings";
import * as materiality from "./materialityJudge";
import { applyEvalGate, computeTweetResult, determineOutcome, scorePipelineResult, type TweetComputeOutput } from "./processTweet";

const result = outcomeToResult({ id: "123", text: "The post" }, "simple-bot", {
  type: "note",
  noteText: "A correction.",
  sources: ["https://example.com/source"],
  searchResults: "The findings",
});

type ScoringOutput = Awaited<ReturnType<typeof scorePipelineResult>>;

const GATED = { ...DEFAULT_CONFIG, materiality_gate_threshold: 0.5 };

function scoring(materialityGate: ScoringOutput["materialityGate"]): ScoringOutput {
  return { scores: [], materialityGate };
}

describe("early gate warnings", () => {
  const restores: Array<() => void> = [];
  function keep<T extends { mockRestore(): void }>(spy: T): T {
    restores.push(() => spy.mockRestore());
    return spy;
  }
  afterEach(() => restores.splice(0).reverse().forEach(restore => restore()));

  test("retains topic-filter fail-open warnings when the note-needed gate rejects", async () => {
    keep(spyOn(botInput, "createBotInput").mockResolvedValue({} as Awaited<ReturnType<typeof botInput.createBotInput>>));
    keep(spyOn(userMessage, "buildUserMessageFromInput").mockReturnValue("The post"));
    const call = keep(spyOn(jsonLlm, "runJsonLlmCall").mockRejectedValue(new Error("provider unavailable")));
    keep(spyOn(prefilter, "runNoteNeededPrefilter").mockResolvedValue({ needsNote: false, reasoning: "No correction needed" }));
    keep(spyOn(console, "warn").mockImplementation(() => {}));
    const botRun = mock(async () => { throw new Error("The full bot should not run"); });
    const log = createTweetLog();

    const output = await withWarnings(() => withCostTracker(() => withTweetLog(log, () =>
      withBotConfig({ ...DEFAULT_CONFIG, topic_filter: true, note_prefilter: true }, () =>
        computeTweetResult({ id: "123", text: "The post" } as Post, {
          id: "test-bot", name: "Test", description: "Test", runPipeline: botRun,
        })),
    )));

    expect(call).toHaveBeenCalledTimes(2);
    expect(botRun).not.toHaveBeenCalled();
    expect(output.outcome).toBe("rejected");
    expect(output.outcomeReason).toBe("prefilter_no_note");
    expect(output.flatLog["topic_filter.failedOpen"]).toBe(true);
    expect(output.warnings).toEqual([
      expect.stringContaining("deepseek/deepseek-v4-flash failed; trying google/gemini-3-flash-preview"),
      expect.stringContaining("both models failed — failing open"),
    ]);
    expect(output.flatLog.warnings).toEqual(output.warnings);
  });
});

describe("determineOutcome materiality gate", () => {
  test("a low materiality score rejects", () => {
    expect(determineOutcome(result, scoring({ threshold: 0.5, score: 0.4, shouldSubmit: false })))
      .toEqual({
        outcome: "rejected",
        outcomeReason: "low_materiality_score",
        finalStage: "evaluation",
        errorMessage: "materiality score 0.4 below threshold 0.5",
      });
  });

  for (const score of [0.5, 0.8]) {
    test(`materiality score ${score} is a candidate`, () => {
      expect(determineOutcome(result, scoring({ threshold: 0.5, score, shouldSubmit: true })))
        .toEqual({ outcome: "candidate", finalStage: "candidate" });
    });
  }

  test("an undefined score skips the gate", () => {
    expect(determineOutcome(result, scoring({ threshold: 0.5 })))
      .toEqual({ outcome: "candidate", finalStage: "candidate" });
  });

  test("an advisory rejection remains a candidate", () => {
    expect(determineOutcome(result, scoring({ threshold: 0.5, score: 0.1, shouldSubmit: false, advisory: true })))
      .toEqual({ outcome: "candidate", finalStage: "candidate" });
  });

  test("a failed source check wins over materiality rejection", () => {
    expect(determineOutcome({ ...result, checkResult: "NO" }, scoring({
      threshold: 0.5, score: 0.1, shouldSubmit: false,
    }))).toEqual({
      outcome: "rejected", outcomeReason: "check_failed", finalStage: "check", errorMessage: "check: NO",
    });
  });
});

describe("materiality scoring", () => {
  let judge: ReturnType<typeof spyOn<typeof materiality, "runMaterialityJudge">>;

  afterEach(() => judge?.mockRestore());

  function mockScores(value: unknown) {
    judge = spyOn(materiality, "runMaterialityJudge").mockResolvedValue([
      { type: "materiality_engages", value: 1, label: "YES", metadata: {} },
      { type: "materiality_takeaway", value: 1, label: "YES", metadata: {} },
      { type: "materiality_convince", value: 1, label: "YES", metadata: {} },
      { type: "materiality_overall", value: value as number, label: "FAIL", metadata: {} },
    ]);
  }

  for (const [score, shouldSubmit] of [[0.49, false], [0.5, true], [0.8, true]] as const) {
    test(`persuasion score ${score} produces shouldSubmit ${shouldSubmit}`, async () => {
      mockScores(score);
      const log = createTweetLog();
      const output = await withBotConfig(GATED, () =>
        withTweetLog(log, () => scorePipelineResult(result)));
      expect(output.materialityGate).toEqual({ threshold: 0.5, score, shouldSubmit, advisory: false });
      expect(output.scores.filter(entry => entry.type.startsWith("materiality_"))).toHaveLength(4);
      expect(log.get("materiality.overall")).toBe(score);
      expect(log.get("materiality.threshold")).toBe(0.5);
      expect(log.get("materiality.shouldSubmit")).toBe(shouldSubmit);
      expect(judge).toHaveBeenCalledWith({
        postText: "The post", findings: "The findings", noteText: "A correction. https://example.com/source",
      });
    });
  }

  for (const value of [undefined, null, "0.1", NaN]) {
    test(`a non-number score (${String(value)}) skips the gate`, async () => {
      mockScores(value);
      const output = await withBotConfig(GATED, () => scorePipelineResult(result));
      expect(output.materialityGate.score).toBeUndefined();
      expect(output.materialityGate.shouldSubmit).toBeUndefined();
      expect(determineOutcome(result, output).outcome).toBe("candidate");
    });
  }

  test("the default config leaves the gate off", async () => {
    mockScores(0.1);
    const output = await withBotConfig(DEFAULT_CONFIG, () => scorePipelineResult(result));
    expect(output.materialityGate.score).toBe(0.1);
    expect(output.materialityGate.shouldSubmit).toBeUndefined();
    expect(determineOutcome(result, output).outcome).toBe("candidate");
  });

  test("a judge error is recorded and skips the gate", async () => {
    mockScores(0.1);
    judge.mockRejectedValue(new Error("judge unavailable"));
    const log = createTweetLog();
    const output = await withBotConfig(GATED, () =>
      withTweetLog(log, () => scorePipelineResult(result)));
    expect(output.materialityGate.error).toBe("Error: judge unavailable");
    expect(log.get("materiality.error")).toBe(output.materialityGate.error);
    expect(output.materialityGate.shouldSubmit).toBeUndefined();
    expect(determineOutcome(result, output).outcome).toBe("candidate");
  });

  test("monitoring makes the gate advisory", async () => {
    mockScores(0.1);
    const output = await withBotConfig(GATED, () => withMonitoringContext({
      topicId: "trump_election_security", topicTitle: "A curated topic", document: "Reference findings",
    }, () => scorePipelineResult(result)));
    expect(output.materialityGate.advisory).toBe(true);
    expect(output.materialityGate.shouldSubmit).toBe(false);
    expect(determineOutcome(result, output).outcome).toBe("candidate");
  });
});

describe("applyEvalGate", () => {
  let evaluate: ReturnType<typeof spyOn<typeof evaluation, "getEvaluationScore">>;
  afterEach(() => evaluate?.mockRestore());

  const post = { id: "123", text: "The post" } as Post;

  function candidateOutput(overrides: Partial<TweetComputeOutput> = {}): TweetComputeOutput {
    return {
      pipelineResult: result,
      outcome: "candidate",
      finalStage: "candidate",
      noteStatus: "CORRECTION WITH TRUSTWORTHY CITATION",
      noteText: "A correction. https://example.com/source",
      scores: [],
      flatLog: {},
      bot: { name: "simple-bot", config: { eval_submit_threshold: -3 } },
      ...overrides,
    };
  }

  test("a score below the threshold rejects a candidate", async () => {
    evaluate = spyOn(evaluation, "getEvaluationScore").mockResolvedValue({ score: -4 });
    const out = candidateOutput();
    await applyEvalGate(post, out, false);
    expect(evaluate).toHaveBeenCalledWith("123", "A correction. https://example.com/source");
    expect(out).toMatchObject({
      outcome: "rejected",
      outcomeReason: "low_evaluation_score",
      finalStage: "evaluation",
      errorMessage: "eval score -4 below threshold -3",
      evaluationScore: -4,
    });
    expect(out.scores).toEqual([{ type: "evaluation", value: -4, metadata: { threshold: -3, passed: false } }]);
    expect(out.flatLog).toMatchObject({
      "eval.threshold": -3, "eval.score": -4, "eval.shouldSubmit": false,
      "outcome.result": "rejected", "outcome.reason": "low_evaluation_score", "outcome.finalStage": "evaluation",
    });
  });

  test("a passing score keeps the candidate and records the score", async () => {
    evaluate = spyOn(evaluation, "getEvaluationScore").mockResolvedValue({ score: 0.2 });
    const out = candidateOutput();
    await applyEvalGate(post, out, false);
    expect(out.outcome).toBe("candidate");
    expect(out.evaluationScore).toBe(0.2);
    expect(out.flatLog["eval.shouldSubmit"]).toBe(true);
  });

  test("an advisory gate records a low score without rejecting", async () => {
    evaluate = spyOn(evaluation, "getEvaluationScore").mockResolvedValue({ score: -9 });
    const out = candidateOutput();
    await applyEvalGate(post, out, true);
    expect(out.outcome).toBe("candidate");
    expect(out.evaluationScore).toBe(-9);
    expect(out.flatLog["eval.advisory"]).toBe(true);
  });

  test("a failed call records the error and keeps the candidate", async () => {
    evaluate = spyOn(evaluation, "getEvaluationScore").mockResolvedValue({ error: "Request failed with status code 403" });
    const out = candidateOutput();
    await applyEvalGate(post, out, false);
    expect(out.outcome).toBe("candidate");
    expect(out.evaluationScore).toBeUndefined();
    expect(out.flatLog["eval.error"]).toBe("Request failed with status code 403");
  });

  test("a note rejected earlier gets a score but keeps its rejection", async () => {
    evaluate = spyOn(evaluation, "getEvaluationScore").mockResolvedValue({ score: -5 });
    const out = candidateOutput({ outcome: "rejected", outcomeReason: "check_failed", finalStage: "check" });
    await applyEvalGate(post, out, false);
    expect(out.outcomeReason).toBe("check_failed");
    expect(out.evaluationScore).toBe(-5);
  });

  test("a run without a correction note is not evaluated", async () => {
    evaluate = spyOn(evaluation, "getEvaluationScore").mockResolvedValue({ score: 1 });
    const out = candidateOutput({ outcome: "rejected", noteStatus: "NO CORRECTION NEEDED", noteText: "" });
    await applyEvalGate(post, out, false);
    expect(evaluate).not.toHaveBeenCalled();
    expect(out.flatLog).toEqual({});
  });
});
