import { expect, test } from "bun:test";
import { flowMarginColumn, MARKER_SIZE, placeMarginCards, placeMarkers, type ColumnEntry } from "./marginCards";

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

test("a card the reader opened sits at its own passage, and the card above in its way closes", () => {
  const tops = placeMarginCards(
    [{ claimId: "a", passageTop: 0, openedByReader: false }, { claimId: "b", passageTop: 50, openedByReader: true }],
    HEIGHTS,
  );
  expect(tops).toEqual(new Map([["b", 50]]));
});

test("a card below the one the reader opened moves under it, and closes when that is too far", () => {
  const near = placeMarginCards(
    [{ claimId: "a", passageTop: 0, openedByReader: true }, { claimId: "b", passageTop: 150, openedByReader: false }],
    HEIGHTS,
  );
  expect(near).toEqual(new Map([["a", 0], ["b", 312]]));
  const far = placeMarginCards(
    [{ claimId: "a", passageTop: 0, openedByReader: true }, { claimId: "b", passageTop: 100, openedByReader: false }],
    HEIGHTS,
  );
  expect(far).toEqual(new Map([["a", 0]]));
});

test("cards clear of the opened card keep their places, however many there are", () => {
  const heights = new Map([["a", 100], ["b", 100], ["c", 100], ["d", 100]]);
  const tops = placeMarginCards(
    [
      { claimId: "a", passageTop: 0, openedByReader: false },
      { claimId: "b", passageTop: 120, openedByReader: false },
      { claimId: "c", passageTop: 130, openedByReader: true },
      { claimId: "d", passageTop: 500, openedByReader: false },
    ],
    heights,
  );
  // a fits above c. b overlaps c, and below c it would be 122 px from its
  // passage, which is close enough. d is clear of everything.
  expect(tops).toEqual(new Map([["a", 0], ["c", 130], ["b", 242], ["d", 500]]));
});

test("markers on the same line are pushed down one below the other", () => {
  expect(placeMarkers([{ key: "b", top: 10 }, { key: "a", top: 0 }, { key: "c", top: 200 }]))
    .toEqual(new Map([["a", 0], ["b", MARKER_SIZE + 6], ["c", 200]]));
});

test("a marker under an open card moves below it", () => {
  expect(placeMarkers([{ key: "a", top: 50 }, { key: "b", top: 400 }], [{ top: 0, bottom: 300 }]))
    .toEqual(new Map([["a", 306], ["b", 400]]));
});

const DOT_STEP = MARKER_SIZE + 6;
const entry = (key: string, anchor: number, mode: ColumnEntry<string>["mode"] = "auto", openedRank?: number, height = 300): ColumnEntry<string> => ({ key, anchor, height, mode, openedRank });

test("in a crowded paragraph the first entry opens and the others are dots below it", () => {
  const layout = flowMarginColumn([entry("a", 0), entry("b", 10), entry("c", 20), entry("d", 2000)]);
  expect(layout).toEqual(new Map([
    ["a", { top: 0, shown: "card" }],
    ["b", { top: 312, shown: "dot" }],
    ["c", { top: 312 + DOT_STEP, shown: "dot" }],
    ["d", { top: 2000, shown: "card" }],
  ]));
});

test("opening a dot turns it into a card in place, moves only what is below, and keeps earlier cards still", () => {
  const before = flowMarginColumn([entry("a", 0, "closed"), entry("b", 10), entry("c", 20)]);
  const openedB = flowMarginColumn([entry("a", 0, "closed"), entry("b", 10, "opened", 1), entry("c", 20)]);
  expect(openedB.get("a")).toEqual(before.get("a"));
  expect(openedB.get("b")).toEqual({ top: before.get("b")!.top, shown: "card" });
  expect(openedB.get("c")).toEqual({ top: DOT_STEP + 300 + 12, shown: "dot" });
  // a then opens too. It takes its place at its words, and b moves to 312,
  // 302 px below its words, so b shows as a dot until a closes.
  const thenA = flowMarginColumn([entry("a", 0, "opened", 2), entry("b", 10, "opened", 1), entry("c", 20)]);
  expect(thenA.get("a")).toEqual({ top: 0, shown: "card" });
  expect(thenA.get("b")).toEqual({ top: 312, shown: "dot" });
});

test("a card the reader closed stays a dot", () => {
  expect(flowMarginColumn([entry("a", 0, "closed")]).get("a")).toEqual({ top: 0, shown: "dot" });
});

test("the newest opened card closes the earlier ones above it that are in its way", () => {
  const entries = [entry("a", 0, "opened", 1), entry("b", 100, "opened", 2), entry("c", 1000, "opened", 3)];
  const layout = flowMarginColumn(entries);
  // b is newer than a and would land at 312 with a open, 212 px below its
  // words, so a closes and b sits at its words. c is far away and stays open.
  expect(layout.get("a")).toEqual({ top: 0, shown: "dot" });
  expect(layout.get("b")).toEqual({ top: 100, shown: "card" });
  expect(layout.get("c")).toEqual({ top: 1000, shown: "card" });
});
