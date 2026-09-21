import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { SupabaseLogger } from "../../api/supabaseClient";
import { flagsThenEval } from "../ranking/scorers";
import * as submission from "./submitNoteForTweet";
import { submitCandidates, type Candidate, type SubmitOptions } from "./submitCandidates";
import { candidateFromQueuedRun, mergeWithQueue, orderByRater, rateCandidate, type QueuedRun } from "./noteQueue";
import * as noteRater from "../score/noteRater";
import { splitUrls } from "../score/noteRater";

const now = Date.parse("2026-09-21T12:00:00Z");
const options: SubmitOptions = {
  policy: "flags_then_eval",
  scorer: flagsThenEval,
  window: { cap: 15, capSource: "last_403", used24h: 14, remaining: 1 },
  bar: 35,
  barState: "set",
  rng: () => 0,
  queue: true,
};

function candidate(id: string, rating: [number, number] | null, queuedAt?: string): Candidate {
  return {
    post: { id, author_id: "a", created_at: new Date(now - 6 * 3_600_000).toISOString(), text: "claim", media: [], author_followers: 100 },
    tweetResult: { pipelineResult: null, outcome: "candidate", finalStage: "candidate", evaluationScore: 0, scores: [], pipelineRunId: `run-${id}`, noteText: "note" },
    botId: "simple-bot",
    velocity: 40_000,
    rating: rating ? { pHelpful: rating[0], pNotHelpful: rating[1], model: "m", cost: 0 } : null,
    ...(queuedAt ? { queuedAt } : {}),
  };
}

function loggerMock() {
  const insertRankingDecisions = mock(async (_rows: Record<string, unknown>[]) => {});
  const completePipelineRun = mock(async () => {});
  const markRunsQueued = mock(async (_ids: string[]) => {});
  const logger = { insertRankingDecisions, completePipelineRun, markRunsQueued } as unknown as SupabaseLogger;
  return { logger, insertRankingDecisions, completePipelineRun, markRunsQueued };
}

beforeEach(() => {
  spyOn(Date, "now").mockReturnValue(now);
  spyOn(console, "log").mockImplementation(() => {});
  spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => mock.restore());

describe("orderByRater", () => {
  test("best net forecast first, unrated last in their original order", () => {
    const order = orderByRater([
      candidate("unratedA", null), candidate("mid", [0.2, 0.05]), candidate("unratedB", null),
      candidate("best", [0.4, 0.02]), candidate("worst", [0.1, 0.3]),
    ]).map((c) => c.post.id);
    expect(order).toEqual(["best", "mid", "worst", "unratedA", "unratedB"]);
  });
});

describe("submitCandidates with the queue on", () => {
  test("submits in rater order, ignores the flags bar, and leaves what X refused queued", async () => {
    const submit = spyOn(submission, "submitNoteForTweet")
      .mockResolvedValueOnce({ status: "submitted", noteId: "n1" })
      .mockResolvedValueOnce({ status: "daily_limit" });
    const { logger, insertRankingDecisions, completePipelineRun, markRunsQueued } = loggerMock();
    const fresh = candidate("fresh", [0.1, 0.05]);
    const oldBest = candidate("oldBest", [0.5, 0.01], "2026-09-21T08:00:00Z");
    const oldMid = candidate("oldMid", [0.3, 0.02], "2026-09-21T09:00:00Z");

    expect(await submitCandidates([fresh, oldBest, oldMid], logger, false, options)).toBe(1);
    expect(submit.mock.calls.map(([c]) => c.post.id)).toEqual(["oldBest", "oldMid"]);
    // Nothing is closed. The fresh note behind the refusal is marked as queued;
    // the refused note was queued already, so it is not marked again.
    expect(completePipelineRun).not.toHaveBeenCalled();
    expect(markRunsQueued.mock.calls).toEqual([[["run-fresh"]]]);
    const rows = insertRankingDecisions.mock.calls[0]![0];
    expect(rows.map((r) => [r.tweet_id, r.decision])).toEqual([["oldBest", "submitted"], ["fresh", "queued_at_limit"]]);
    expect(rows[0]).toMatchObject({ scores: { note_rater: 0.49 }, bar_state: "queue" });
  });

  test("a queued note whose tweet is past the 24h cutoff is closed as stale, never submitted", async () => {
    const submit = spyOn(submission, "submitNoteForTweet").mockResolvedValue({ status: "submitted", noteId: "n1" });
    const { logger, completePipelineRun } = loggerMock();
    const old = candidate("old", [0.9, 0], "2026-09-21T01:00:00Z");
    old.post.created_at = new Date(now - 25 * 3_600_000).toISOString();
    expect(await submitCandidates([old], logger, false, options)).toBe(0);
    expect(submit).not.toHaveBeenCalled();
    expect(completePipelineRun.mock.calls[0]).toEqual(["run-old", { outcome: "rejected", outcome_reason: "stale_at_submit", final_stage: "submission" }] as any);
  });

  test("a queued note that is still busy is not logged again every run", async () => {
    spyOn(submission, "submitNoteForTweet").mockResolvedValueOnce({ status: "submission_busy", reason: "claimed", capacity: {} as any });
    const { logger, insertRankingDecisions, completePipelineRun } = loggerMock();
    await submitCandidates([candidate("busy", [0.3, 0], "2026-09-21T08:00:00Z")], logger, false, options);
    expect(completePipelineRun).not.toHaveBeenCalled();
    expect(insertRankingDecisions.mock.calls.flatMap(([rows]) => rows)).toEqual([]);
  });

  test("a queued note whose tweet already has our note is closed, not retried", async () => {
    spyOn(submission, "submitNoteForTweet").mockResolvedValueOnce({ status: "submission_busy", reason: "submitted", capacity: {} as any });
    const { logger, completePipelineRun } = loggerMock();
    await submitCandidates([candidate("dup", [0.3, 0], "2026-09-21T08:00:00Z")], logger, false, options);
    expect(completePipelineRun.mock.calls[0]).toEqual(["run-dup", { outcome: "rejected", outcome_reason: "already_noted", final_stage: "submission" }] as any);
  });

  test("with the queue off: arrival order, and the rest are rejected at the limit", async () => {
    const submit = spyOn(submission, "submitNoteForTweet").mockResolvedValueOnce({ status: "daily_limit" });
    const { logger, completePipelineRun, markRunsQueued } = loggerMock();
    // "a" arrives first but is rated lower, so rater order leaking in would submit "b" first.
    await submitCandidates([candidate("a", [0.1, 0]), candidate("b", [0.5, 0])], logger, false, { ...options, queue: false, scorer: null, bar: null, barState: "off" });
    expect(submit.mock.calls.map(([c]) => c.post.id)).toEqual(["a"]);
    expect(markRunsQueued).not.toHaveBeenCalled();
    expect(completePipelineRun).toHaveBeenCalledTimes(1);
    expect(completePipelineRun.mock.calls[0]).toEqual(["run-b", { outcome: "rejected", outcome_reason: "daily_limit_reached", final_stage: "submission" }] as any);
  });
});

describe("queue rows", () => {
  const run: QueuedRun = {
    id: "r1", tweet_id: "2101082614044258712", note_text: "Note text https://example.com",
    source_url: "https://example.com", bot_name: "simple-bot", created_at: "2026-09-21T08:00:00Z", velocity: 12_000, evaluationScore: 0.4,
    rating: { pHelpful: 0.3, pNotHelpful: 0.05, model: "m", cost: 0.002 },
    tweet: {
      tweet_id: "2101082614044258712", author_id: "9", author_name: "A", author_description: null, author_followers: 5,
      author_tweet_count: null, text: "post", posted_at: "2026-09-21T02:00:00Z", impressions: 1000, likes: 1,
      retweets: 0, replies: 0, quotes: 0, bookmarks: 0, media: [{ type: "photo" }], referenced_tweets: null, referenced_tweet_data: null,
    },
  };

  test("a queued row becomes a submittable candidate", () => {
    const c = candidateFromQueuedRun(run)!;
    expect(c.post).toMatchObject({ id: run.tweet_id, text: "post", created_at: "2026-09-21T02:00:00Z", author_followers: 5 });
    expect(c.tweetResult).toMatchObject({ pipelineRunId: "r1", noteText: run.note_text, outcome: "candidate", evaluationScore: 0.4 });
    expect(c).toMatchObject({ velocity: 12_000, queuedAt: run.created_at, sourceUrl: "https://example.com" });
  });

  test("a row without note text is dropped; a missing tweets row still submits", () => {
    expect(candidateFromQueuedRun({ ...run, note_text: " " })).toBeNull();
    expect(candidateFromQueuedRun({ ...run, tweet: null })!.post).toMatchObject({ id: run.tweet_id, text: "" });
  });

  test("merge drops queued notes for tweets this run just wrote", () => {
    const fresh = [candidate("t1", [0.1, 0])];
    const queued = [candidate("t1", [0.5, 0], "x"), candidate("t2", [0.2, 0], "x")];
    queued[0]!.tweetResult.pipelineRunId = "older-run";
    expect(mergeWithQueue(fresh, queued).map((c) => c.post.id)).toEqual(["t1", "t2"]);
    expect(mergeWithQueue(fresh, queued)[0]!.rating?.pHelpful).toBe(0.1);
  });
});

describe("rateCandidate", () => {
  const post = { id: "t", author_id: "a", created_at: "", text: "claim", media: [] };
  const result = { pipelineRunId: "run-t", noteText: "note", pipelineResult: null };

  test("a rater failure returns null and does not throw", async () => {
    spyOn(noteRater, "rateNote").mockRejectedValueOnce(new Error("provider down"));
    expect(await rateCandidate(null, post, result)).toBeNull();
  });

  test("a failure to store the rating still returns the rating", async () => {
    spyOn(noteRater, "rateNote").mockResolvedValueOnce({ pHelpful: 0.3, pNotHelpful: 0.1, model: "m", cost: 0 });
    const logger = { recordNoteRating: mock(async () => { throw new Error("db down"); }) } as unknown as SupabaseLogger;
    expect(await rateCandidate(logger, post, result)).toMatchObject({ pHelpful: 0.3 });
  });
});

test("splitUrls matches the backtest's split", () => {
  expect(splitUrls("https://a.com/x), https://b.org/y.")).toEqual(["https://a.com/x", "https://b.org/y"]);
  expect(splitUrls("a.com b.org")).toEqual(["a.com", "b.org"]);
  expect(splitUrls(null)).toEqual([]);
});
