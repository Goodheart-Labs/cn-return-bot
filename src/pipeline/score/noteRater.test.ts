import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { SupabaseLogger } from "../../api/supabaseClient";
import * as noteRater from "./noteRater";
import { rateCandidate, raterPriority, splitUrls } from "./noteRater";

const note = { tweetId: "t1", postText: "claim", noteText: "note https://a.com", sourceUrl: "https://a.com", pipelineRunId: "run-1" };
const rating = { pHelpful: 0.3, pNotHelpful: 0.1, model: "m", cost: 0.002 };

beforeEach(() => {
  spyOn(console, "log").mockImplementation(() => {});
  spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  mock.restore();
  delete process.env.NOTE_RATER_ENABLED;
});

describe("rateCandidate", () => {
  test("forecasts the note and stores the forecast against its run", async () => {
    spyOn(noteRater, "rateNote").mockResolvedValueOnce({ ...rating });
    const recordNoteRating = mock(async () => {});
    const logger = { recordNoteRating } as unknown as SupabaseLogger;
    const got = await rateCandidate(logger, note);
    expect(got).toMatchObject({ ...rating, calibrationFittedAt: "2026-09-12" });
    // The calibration pulls the raw numbers down to the observed level.
    expect(got!.pHelpfulCalibrated!).toBeLessThan(rating.pHelpful); expect(got!.pNotHelpfulCalibrated!).toBeLessThan(rating.pNotHelpful);
    const stored = (recordNoteRating.mock.calls as unknown as [string, unknown][])[0]!;
    expect(stored[0]).toBe("run-1"); expect(stored[1]).toBe(got);
  });

  test("a rater failure returns null and does not throw", async () => {
    spyOn(noteRater, "rateNote").mockRejectedValueOnce(new Error("provider down"));
    expect(await rateCandidate(null, note)).toBeNull();
  });

  test("a failure to store the forecast still returns it", async () => {
    spyOn(noteRater, "rateNote").mockResolvedValueOnce({ ...rating });
    const logger = { recordNoteRating: mock(async () => { throw new Error("db down"); }) } as unknown as SupabaseLogger;
    expect(await rateCandidate(logger, note)).toMatchObject(rating);
  });

  test("switched off, or with no note text, it makes no call", async () => {
    const rate = spyOn(noteRater, "rateNote").mockResolvedValue({ ...rating });
    expect(await rateCandidate(null, { ...note, noteText: "" })).toBeNull();
    process.env.NOTE_RATER_ENABLED = "false";
    expect(await rateCandidate(null, note)).toBeNull();
    expect(rate).not.toHaveBeenCalled();
  });
});

test("the score is helpful minus not helpful", () => {
  expect(raterPriority(rating)).toBeCloseTo(0.2);
});

test("splitUrls matches the backtest's split", () => {
  expect(splitUrls("https://a.com/x), https://b.org/y.")).toEqual(["https://a.com/x", "https://b.org/y"]);
  expect(splitUrls("a.com b.org")).toEqual(["a.com", "b.org"]);
  expect(splitUrls(null)).toEqual([]);
});
