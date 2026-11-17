import { expect, test } from "bun:test";
import { positionAfterMove, positionBetween } from "./bestNotes";

test("a note placed between two neighbours lands halfway", () => {
  expect(positionBetween(1, 2)).toBe(1.5);
});

test("a note placed at an end of the list goes one past it", () => {
  expect(positionBetween(5, undefined)).toBe(6);
  expect(positionBetween(undefined, 5)).toBe(4);
  expect(positionBetween(undefined, undefined)).toBe(0);
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

