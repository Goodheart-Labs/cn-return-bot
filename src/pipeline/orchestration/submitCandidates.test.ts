import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { SupabaseLogger } from "../../api/supabaseClient";
import { flagsThenEval, velocityOnly } from "../ranking/scorers";
import * as submission from "./submitNoteForTweet";
import { submitCandidates, type Candidate, type SubmitOptions } from "./submitCandidates";

const now = Date.parse("2026-09-07T12:00:00Z");
const options: SubmitOptions = {
  policy: "flags_then_eval",
  scorer: flagsThenEval,
  window: { cap: 40, capSource: "writing_limit", used24h: 10, remaining: 30 },
  bar: 35,
  barState: "set",
  rng: () => 0,
};

function candidate(id: string, ageHours = 6, velocity = 40_000): Candidate {
  return {
    post: { id, author_id: "author", created_at: new Date(now - ageHours * 3_600_000).toISOString(), text: "claim", media: [{ type: "photo" }], author_followers: 100 },
    tweetResult: { pipelineResult: null, outcome: "candidate", finalStage: "evaluation", evaluationScore: 1, scores: [], pipelineRunId: id },
    botId: "simple-bot",
    velocity,
  };
}

function loggerMock() {
  const insertRankingDecisions = mock(async (_rows: Record<string, unknown>[]) => {});
  const completePipelineRun = mock(async () => {});
  const logger = { insertRankingDecisions, completePipelineRun } as unknown as SupabaseLogger;
  return { logger, insertRankingDecisions, completePipelineRun };
}

beforeEach(() => {
  spyOn(Date, "now").mockReturnValue(now);
  spyOn(console, "log").mockImplementation(() => {});
  spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => mock.restore());

describe("submitCandidates ranking", () => {
  test("freezes scores across an age boundary for ordering, the bar, logs and decisions", async () => {
    const crossing = candidate("crossing", 12 - 1 / 3600);
    const lower = candidate("lower");
    lower.tweetResult.evaluationScore = 0;
    const floor = candidate("floor", 6, 100);
    const stale = candidate("stale", 25);
    const below = candidate("below", 13);
    const flagsScore = spyOn(flagsThenEval, "scoreSubmit");
    const velocityScore = spyOn(velocityOnly, "scoreSubmit");
    const submit = spyOn(submission, "submitNoteForTweet").mockImplementation(async () => {
      spyOn(Date, "now").mockReturnValue(now + 2000);
      return { status: "submitted", noteId: "note" };
    });
    const { logger, insertRankingDecisions } = loggerMock();

    expect(await submitCandidates([lower, crossing, floor, stale, below], logger, false, options)).toBe(2);
    expect(submit.mock.calls.map(([c]) => c.post.id)).toEqual(["crossing", "lower"]);
    expect(flagsScore).toHaveBeenCalledTimes(5);
    expect(velocityScore).toHaveBeenCalledTimes(5);
    expect(insertRankingDecisions).toHaveBeenCalledTimes(1);
    const rows = insertRankingDecisions.mock.calls[0]![0];
    expect(rows.find((r) => r.tweet_id === "crossing")).toMatchObject({ submit_score: 41, scores: { flags_then_eval: 41 }, flags: 4, decision: "submitted" });
    expect(rows.find((r) => r.tweet_id === "floor")).toMatchObject({ decision: "below_velocity_floor", flags: 3 });
    expect(rows.find((r) => r.tweet_id === "stale")).toMatchObject({ decision: "stale_at_submit", flags: 3 });
    expect(rows.find((r) => r.tweet_id === "below")).toMatchObject({ decision: "below_bar", submit_score: 31 });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("crossing velocity_only=4.60 flags_then_eval=41.00"));
  });

  test("flushes accumulated decisions once when a later submission throws", async () => {
    const error = new Error("submission interrupted");
    spyOn(submission, "submitNoteForTweet")
      .mockResolvedValueOnce({ status: "submitted", noteId: "note" })
      .mockRejectedValueOnce(error);
    const { logger, insertRankingDecisions } = loggerMock();
    await expect(submitCandidates([candidate("first"), candidate("second"), candidate("floor", 6, 100)], logger, false, options)).rejects.toBe(error);
    expect(insertRankingDecisions).toHaveBeenCalledTimes(1);
    expect(insertRankingDecisions.mock.calls[0]![0].map((r) => [r.tweet_id, r.decision])).toEqual([
      ["floor", "below_velocity_floor"], ["first", "submitted"],
    ]);
  });

  test("a failed flush does not replace the submission exception", async () => {
    const error = new Error("submission interrupted");
    spyOn(submission, "submitNoteForTweet").mockRejectedValue(error);
    const { logger, insertRankingDecisions } = loggerMock();
    insertRankingDecisions.mockRejectedValue(new Error("database unavailable"));
    await expect(submitCandidates([candidate("first"), candidate("floor", 6, 100)], logger, false, options)).rejects.toBe(error);
    expect(insertRankingDecisions).toHaveBeenCalledTimes(1);
  });

  test("dry run returns zero without submitting, completing runs or flushing", async () => {
    const submit = spyOn(submission, "submitNoteForTweet");
    const { logger, insertRankingDecisions, completePipelineRun } = loggerMock();
    expect(await submitCandidates([candidate("kept"), candidate("floor", 6, 100), candidate("stale", 25), candidate("below", 13)], logger, true, options)).toBe(0);
    expect(submit).not.toHaveBeenCalled();
    expect(completePipelineRun).not.toHaveBeenCalled();
    expect(insertRankingDecisions).not.toHaveBeenCalled();
  });

  test("does not flush an empty decision list", async () => {
    const { logger, insertRankingDecisions } = loggerMock();
    expect(await submitCandidates([], logger, false, options)).toBe(0);
    expect(insertRankingDecisions).not.toHaveBeenCalled();
  });

  test.each([
    ["set", 35], ["admit_all", -Infinity], ["reject_all", Infinity], ["none", null], ["off", null], ["error", null],
  ] as [SubmitOptions["barState"], number | null][])("persists bar state %s with an explicitly finite or null bar", async (barState, bar) => {
    spyOn(submission, "submitNoteForTweet").mockResolvedValue({ status: "submitted", noteId: "note" });
    const { logger, insertRankingDecisions } = loggerMock();
    await submitCandidates([candidate("kept"), candidate("floor", 6, 100), candidate("stale", 25)], logger, false, { ...options, bar, barState, scorer: barState === "none" ? null : flagsThenEval });
    const rows = insertRankingDecisions.mock.calls[0]![0];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.bar_state).toBe(barState);
      expect(row.bar).toBe(barState === "set" ? 35 : null);
      expect(row.remaining).toBe(30);
    }
  });

  test("the control arm retains pipeline order and stops only at the API limit", async () => {
    const submit = spyOn(submission, "submitNoteForTweet")
      .mockResolvedValueOnce({ status: "submitted", noteId: "note" })
      .mockResolvedValueOnce({ status: "daily_limit" });
    const lower = candidate("lower", 13);
    const higher = candidate("higher");
    const last = candidate("last");
    const { logger, insertRankingDecisions } = loggerMock();
    expect(await submitCandidates([lower, higher, last], logger, false, {
      ...options, policy: "velocity_only", scorer: null, bar: Infinity, barState: "none",
      window: { ...options.window!, remaining: 0 },
    })).toBe(1);
    expect(submit.mock.calls.map(([c]) => c.post.id)).toEqual(["lower", "higher"]);
    expect(insertRankingDecisions.mock.calls[0]![0].map((r) => r.decision)).toEqual(["submitted", "daily_limit_reached", "daily_limit_reached"]);
  });
});
