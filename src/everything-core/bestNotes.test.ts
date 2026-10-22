import { expect, test } from "bun:test";
import { positionsBetween } from "./bestNotes";

test("notes placed between two neighbours are spaced evenly between them", () => {
  expect(positionsBetween(1, 2, 1)).toEqual([1.5]);
  expect(positionsBetween(0, 3, 2)).toEqual([1, 2]);
});

test("notes placed at an end of the list go one apart", () => {
  expect(positionsBetween(5, undefined, 2)).toEqual([6, 7]);
  expect(positionsBetween(undefined, 5, 2)).toEqual([3, 4]);
  expect(positionsBetween(undefined, undefined, 3)).toEqual([0, 1, 2]);
});
