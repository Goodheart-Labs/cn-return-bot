import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { outcomeToResult } from "../../bots/types";
import { DEFAULT_CONFIG, withBotConfig } from "../ab-testing/botConfig";
import { withMonitoringContext } from "../misinfo-monitoring/monitoringContext";
import * as evaluation from "../score/noteEvaluationFilter";
import { createTweetLog, withTweetLog } from "../utils/tweetLog";
import * as materiality from "./materialityJudge";
import { determineOutcome, scorePipelineResult } from "./processTweet";

const result = outcomeToResult({ id: "123", text: "The post" }, "simple-bot", {
  type: "note",
  noteText: "A correction.",
  sources: ["https://example.com/source"],
  searchResults: "The findings",
});

type ScoringOutput = Awaited<ReturnType<typeof scorePipelineResult>>;

const GATED = { ...DEFAULT_CONFIG, materiality_gate_threshold: 0.5 };

function scoring(materialityGate: ScoringOutput["materialityGate"]): ScoringOutput {
  return {
    scores: [],
    evalGate: { threshold: 0.5, score: 0.9, shouldSubmit: true },
    materialityGate,
  };
}

describe("determineOutcome materiality gate", () => {
  test("a low materiality score rejects despite a passing eval gate", () => {
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

  test("materiality rejection wins when both score gates fail", () => {
    const scores = scoring({ threshold: 0.5, score: 0.1, shouldSubmit: false });
    scores.evalGate.shouldSubmit = false;
    expect(determineOutcome(result, scores).outcomeReason).toBe("low_materiality_score");
  });

  test("a passing materiality gate still allows eval rejection", () => {
    const scores = scoring({ threshold: 0.5, score: 0.8, shouldSubmit: true });
    scores.evalGate = { threshold: 0.5, score: 0.1, shouldSubmit: false };
    expect(determineOutcome(result, scores).outcomeReason).toBe("low_evaluation_score");
  });
});

describe("materiality scoring", () => {
  let judge: ReturnType<typeof spyOn<typeof materiality, "runMaterialityJudge">>;
  let evaluate: ReturnType<typeof spyOn<typeof evaluation, "getEvaluationScore">>;

  afterEach(() => {
    judge?.mockRestore();
    evaluate?.mockRestore();
  });

  function mockScores(value: unknown) {
    judge = spyOn(materiality, "runMaterialityJudge").mockResolvedValue([
      { type: "materiality_engages", value: 1, label: "YES", metadata: {} },
      { type: "materiality_takeaway", value: 1, label: "YES", metadata: {} },
      { type: "materiality_convince", value: 1, label: "YES", metadata: {} },
      { type: "materiality_overall", value: value as number, label: "FAIL", metadata: {} },
    ]);
    evaluate = spyOn(evaluation, "getEvaluationScore").mockResolvedValue({ score: 0.9 });
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

  test("monitoring makes both gates advisory", async () => {
    mockScores(0.1);
    const output = await withBotConfig(GATED, () => withMonitoringContext({
      topicId: "trump_election_security", topicTitle: "A curated topic", document: "Reference findings",
    }, () => scorePipelineResult(result)));
    expect(output.evalGate.advisory).toBe(true);
    expect(output.materialityGate.advisory).toBe(output.evalGate.advisory);
    expect(output.materialityGate.shouldSubmit).toBe(false);
    expect(determineOutcome(result, output).outcome).toBe("candidate");
  });
});
