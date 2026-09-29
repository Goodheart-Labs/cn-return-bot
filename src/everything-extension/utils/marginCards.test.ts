import { expect, test } from "bun:test";
import { placeMarginCards } from "./marginCards";

const HEIGHTS = new Map([["a", 300], ["b", 300], ["c", 300]]);

test("cards that would overlap are pushed down below the card above", () => {
  const tops = placeMarginCards(
    [{ claimId: "a", passageTop: 0, openedByReader: true }, { claimId: "b", passageTop: 100, openedByReader: true }],
    HEIGHTS,
  );
  expect(tops).toEqual(new Map([["a", 0], ["b", 312]]));
});

test("a card that would open by itself far below its passage stays closed", () => {
  const tops = placeMarginCards(
    [
      { claimId: "a", passageTop: 0, openedByReader: false },
      { claimId: "b", passageTop: 50, openedByReader: false },
      { claimId: "c", passageTop: 400, openedByReader: false },
    ],
    HEIGHTS,
  );
  // b would land at 312, 262 below its passage, so it keeps just its dot, and
  // c then fits at its own passage.
  expect(tops).toEqual(new Map([["a", 0], ["c", 400]]));
});

test("a card the reader opened is placed however far it is pushed", () => {
  const tops = placeMarginCards(
    [{ claimId: "a", passageTop: 0, openedByReader: false }, { claimId: "b", passageTop: 50, openedByReader: true }],
    HEIGHTS,
  );
  expect(tops.get("b")).toBe(312);
});
