import { expect, test } from "bun:test";
import { positionAfterMove, positionsBetween } from "./bestNotes";

test("notes placed between two neighbours are spaced evenly between them", () => {
  expect(positionsBetween(1, 2, 1)).toEqual([1.5]);
  expect(positionsBetween(0, 3, 2)).toEqual([1, 2]);
});

test("notes placed at an end of the list go one apart", () => {
  expect(positionsBetween(5, undefined, 2)).toEqual([6, 7]);
  expect(positionsBetween(undefined, 5, 2)).toEqual([3, 4]);
  expect(positionsBetween(undefined, undefined, 3)).toEqual([0, 1, 2]);
});

const LIST = [
  { note_id: "a", position: 1 },
  { note_id: "b", position: 2 },
  { note_id: "c", position: 3 },
  { note_id: "d", position: 4 },
];

test("a moved note lands right below the note now above it", () => {
  expect(positionAfterMove(LIST, "d", "a", "b")).toBe(1.5);
  expect(positionAfterMove(LIST, "a", "d", undefined)).toBe(5);
});

test("a note moved to the top of a narrowed list lands right above the note below it", () => {
  // Shown are only b and d; d moves above b, so it lands between a and b.
  expect(positionAfterMove(LIST, "d", undefined, "b")).toBe(1.5);
});
