import { expect, test } from "bun:test";
import { defaultRange, moveRangeEdge, RANGE_STEP_SECONDS } from "./videoNoteRange";

const LONG_VIDEO_SECONDS = 3600;

test("a new range runs from ten seconds back up to the moment the reader asked", () => {
  expect(defaultRange(754.6)).toEqual({ startSeconds: 744, endSeconds: 754 });
});

test("a new range near the video's start begins at its start and is never empty", () => {
  expect(defaultRange(4)).toEqual({ startSeconds: 0, endSeconds: 4 });
  expect(defaultRange(0)).toEqual({ startSeconds: 0, endSeconds: 1 });
});

test("the ends move by one step", () => {
  const range = { startSeconds: 100, endSeconds: 110 };
  expect(moveRangeEdge(range, "start", -RANGE_STEP_SECONDS, LONG_VIDEO_SECONDS)).toEqual({ startSeconds: 95, endSeconds: 110 });
  expect(moveRangeEdge(range, "end", RANGE_STEP_SECONDS, LONG_VIDEO_SECONDS)).toEqual({ startSeconds: 100, endSeconds: 115 });
});

test("the start stops one second before the end, and the end one second after the start", () => {
  const range = { startSeconds: 100, endSeconds: 103 };
  expect(moveRangeEdge(range, "start", RANGE_STEP_SECONDS, LONG_VIDEO_SECONDS)).toEqual({ startSeconds: 102, endSeconds: 103 });
  expect(moveRangeEdge(range, "end", -RANGE_STEP_SECONDS, LONG_VIDEO_SECONDS)).toEqual({ startSeconds: 100, endSeconds: 101 });
});

test("a range grows to two minutes at most", () => {
  const range = { startSeconds: 100, endSeconds: 218 };
  expect(moveRangeEdge(range, "start", -RANGE_STEP_SECONDS, LONG_VIDEO_SECONDS)).toEqual({ startSeconds: 98, endSeconds: 218 });
  expect(moveRangeEdge(range, "end", RANGE_STEP_SECONDS, LONG_VIDEO_SECONDS)).toEqual({ startSeconds: 100, endSeconds: 220 });
});

test("a range stays inside the video", () => {
  expect(moveRangeEdge({ startSeconds: 2, endSeconds: 10 }, "start", -RANGE_STEP_SECONDS, LONG_VIDEO_SECONDS)).toEqual({ startSeconds: 0, endSeconds: 10 });
  expect(moveRangeEdge({ startSeconds: 50, endSeconds: 58 }, "end", RANGE_STEP_SECONDS, 60.4)).toEqual({ startSeconds: 50, endSeconds: 60 });
});

test("a move that is not possible leaves the range as it was", () => {
  const range = { startSeconds: 0, endSeconds: 10 };
  expect(moveRangeEdge(range, "start", -RANGE_STEP_SECONDS, LONG_VIDEO_SECONDS)).toEqual(range);
});
