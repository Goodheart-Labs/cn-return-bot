import { describe, expect, test } from "bun:test";
import { assignLayers, mostSpecific } from "./overlaps";

type Span = [start: number, end: number];
const order = {
  compareStarts: (a: Span, b: Span) => a[0] - b[0],
  overlaps: (a: Span, b: Span) => a[0] < b[1] && b[0] < a[1],
};

describe("assignLayers", () => {
  test("spans that do not overlap share the first layer", () => {
    expect(assignLayers<Span>([[20, 30], [0, 10]], order, 3)).toEqual([[[0, 10], [20, 30]], [], []]);
  });

  test("overlapping spans go into separate layers, so their overlap paints twice", () => {
    expect(assignLayers<Span>([[0, 100], [0, 10], [50, 60]], order, 3)).toEqual([[[0, 100]], [[0, 10], [50, 60]], []]);
  });

  test("touching spans do not overlap", () => {
    expect(assignLayers<Span>([[0, 10], [10, 20]], order, 3)).toEqual([[[0, 10], [10, 20]], [], []]);
  });

  test("past the last layer, spans pile into it, so darkness stops growing", () => {
    expect(assignLayers<Span>([[0, 100], [0, 50], [0, 20], [0, 10]], order, 3)).toEqual([[[0, 100]], [[0, 50]], [[0, 20], [0, 10]]]);
  });
});

describe("mostSpecific", () => {
  test("picks the shortest quote", () => {
    expect(mostSpecific(["the whole paragraph here", "one sentence", "two sentences here"], (s) => s.length)).toBe("one sentence");
  });

  test("nothing to pick gives null", () => {
    expect(mostSpecific([], (s: string) => s.length)).toBeNull();
  });
});
