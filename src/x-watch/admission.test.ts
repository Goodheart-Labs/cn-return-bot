import { expect, test } from "bun:test";
import type { WrittenNote } from "../api/fetchNotesWritten";
import { summariseTestNotes } from "./admission";

const note = (claimOpinion: string | null, urlValidity = "high"): WrittenNote => ({
  id: "1",
  post_id: "2",
  test_result: claimOpinion === null ? {} : {
    evaluation_outcome: [
      { evaluator_type: "ClaimOpinion", evaluator_score_bucket: claimOpinion },
      { evaluator_type: "UrlValidity", evaluator_score_bucket: urlValidity },
    ],
  },
});

const repeat = (count: number, make: () => WrittenNote) => Array.from({ length: count }, make);

test("50 notes with 15 high and 15 low on ClaimOpinion and working links meet the bar", () => {
  const notes = [...repeat(15, () => note("high")), ...repeat(15, () => note("low")), ...repeat(20, () => note("medium"))];
  expect(summariseTestNotes(notes)).toMatchObject({ notes: 50, claimOpinionHigh: 15, claimOpinionLow: 15, urlValidityHigh: 50, meetsCriteria: true });
});

test("one low ClaimOpinion too many, or three broken links, miss the bar", () => {
  expect(summariseTestNotes([...repeat(15, () => note("high")), ...repeat(16, () => note("low")), ...repeat(19, () => note("medium"))]).meetsCriteria).toBe(false);
  expect(summariseTestNotes([...repeat(47, () => note("high")), ...repeat(3, () => note("high", "low"))]).meetsCriteria).toBe(false);
});

test("reads the buckets as X writes them, capitalised", () => {
  expect(summariseTestNotes([note("High", "High"), note("Low", "High"), note("Medium", "High")])).toMatchObject({ claimOpinionHigh: 1, claimOpinionLow: 1, urlValidityHigh: 3 });
});

test("unscored notes count as neither high nor low", () => {
  expect(summariseTestNotes([...repeat(20, () => note("high")), ...repeat(30, () => note(null))])).toMatchObject({ unscored: 30, meetsCriteria: false });
});
