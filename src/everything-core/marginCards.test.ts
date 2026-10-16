import { expect, test } from "bun:test";
import { CARD_BESIDE_OFFSET, flowMarginColumn, MARKER_SIZE, type ColumnEntry, type MarginOptions } from "./marginCards";

const DOT_STEP = MARKER_SIZE + 6;
const MAKE_ROOM: MarginOptions = { dotsMakeRoom: true, cardPlacement: "over" };

/** The layout with dots making room, as one top per entry and whether it
 *  shows as a card or a dot. */
function column(entries: ColumnEntry<string>[]) {
  return new Map([...flowMarginColumn(entries, MAKE_ROOM)].map(([key, placed]) => [key, {
    top: placed.card?.top ?? placed.dotTop,
    shown: placed.card ? "card" : "dot",
    displaced: placed.displaced,
  }]));
}

const entry = (key: string, anchor: number, mode: ColumnEntry<string>["mode"] = "auto", openedRank?: number, height = 300): ColumnEntry<string> => ({ key, anchor, height, mode, openedRank });

test("in a crowded paragraph the first entry opens and the others are dots below it", () => {
  const layout = column([entry("a", 0), entry("b", 10), entry("c", 20), entry("d", 2000)]);
  expect(layout).toEqual(new Map([
    ["a", { top: 0, shown: "card", displaced: false }],
    ["b", { top: 312, shown: "dot", displaced: false }],
    ["c", { top: 312 + DOT_STEP, shown: "dot", displaced: false }],
    ["d", { top: 2000, shown: "card", displaced: false }],
  ]));
});

test("opening a dot turns it into a card in place, moves only what is below, and keeps earlier cards still", () => {
  const before = column([entry("a", 0, "closed"), entry("b", 10), entry("c", 20)]);
  const openedB = column([entry("a", 0, "closed"), entry("b", 10, "opened", 1), entry("c", 20)]);
  expect(openedB.get("a")).toEqual(before.get("a"));
  expect(openedB.get("b")).toEqual({ top: before.get("b")!.top, shown: "card", displaced: false });
  expect(openedB.get("c")).toEqual({ top: DOT_STEP + 300 + 12, shown: "dot", displaced: false });
  // a then opens too. It takes its place at its words, and b moves to 312,
  // 302 px below its words, so b shows as a dot until a closes.
  const thenA = column([entry("a", 0, "opened", 2), entry("b", 10, "opened", 1), entry("c", 20)]);
  expect(thenA.get("a")).toEqual({ top: 0, shown: "card", displaced: false });
  expect(thenA.get("b")).toEqual({ top: 312, shown: "dot", displaced: true });
});

test("a card the reader closed stays a dot", () => {
  expect(column([entry("a", 0, "closed")]).get("a")).toEqual({ top: 0, shown: "dot", displaced: false });
});

test("the newest opened card closes the earlier ones above it that are in its way", () => {
  const entries = [entry("a", 0, "opened", 1), entry("b", 100, "opened", 2), entry("c", 1000, "opened", 3)];
  const layout = column(entries);
  // b is newer than a and would land at 312 with a open, 212 px below its
  // words, so a closes and b sits at its words. c is far away and stays open.
  expect(layout.get("a")).toEqual({ top: 0, shown: "dot", displaced: true });
  expect(layout.get("b")).toEqual({ top: 100, shown: "card", displaced: false });
  expect(layout.get("c")).toEqual({ top: 1000, shown: "card", displaced: false });
});

test("a card that opened by itself gives way to a card the reader opens below it", () => {
  const layout = column([entry("a", 0), entry("b", 10), entry("c", 20, "opened", 1)]);
  expect(layout.get("a")).toEqual({ top: 0, shown: "dot", displaced: true });
  // Once a gives way, b would open by itself in its place and push c down
  // too, so b gives way as well.
  expect(layout.get("b")).toEqual({ top: DOT_STEP, shown: "dot", displaced: true });
  expect(layout.get("c")).toEqual({ top: 2 * DOT_STEP, shown: "card", displaced: false });
});

test("a card opens at its home, where its dot sits when every entry is a dot, even below an open card", () => {
  // a is open at 0 and reaches to 300. c's home is two dot steps down, inside
  // a, so opening c closes a and puts c at its home.
  const layout = column([entry("a", 0, "opened", 1), entry("b", 0), entry("c", 0, "opened", 2)]);
  expect(layout.get("a")).toEqual({ top: 0, shown: "dot", displaced: true });
  expect(layout.get("c")).toEqual({ top: 2 * DOT_STEP, shown: "card", displaced: false });
});

test("by default dots stay at their homes, and a card sits beside the dots it would cover", () => {
  const layout = flowMarginColumn([entry("a", 0), entry("b", 10), entry("c", 2000)]);
  expect(layout.get("a")).toEqual({ dotTop: 0, dotShown: true, card: { top: 0, side: "beside" }, displaced: false });
  expect(layout.get("b")).toEqual({ dotTop: DOT_STEP, dotShown: true, card: null, displaced: false });
  // c covers no other dot, so it sits over the dot column and hides its own dot.
  expect(layout.get("c")).toEqual({ dotTop: 2000, dotShown: false, card: { top: 2000, side: "over" }, displaced: false });
});

test("with dots staying, only cards push cards down", () => {
  const layout = flowMarginColumn([entry("a", 0), entry("b", 100), entry("c", 150)], { dotsMakeRoom: false, cardPlacement: "over" });
  // b would land at 312, 212 px below its home, so it stays a dot. c lands
  // at 312 too, 162 px below its home, so it opens there, below its dot.
  expect(layout.get("b")).toEqual({ dotTop: 100, dotShown: true, card: null, displaced: false });
  expect(layout.get("c")).toEqual({ dotTop: 150, dotShown: true, card: { top: 312, side: "over" }, displaced: false });
});

test("cards beside the dots keep every dot visible", () => {
  const layout = flowMarginColumn([entry("a", 0), entry("b", 2000)], { dotsMakeRoom: false, cardPlacement: "beside" });
  expect([...layout.values()].every((placed) => placed.dotShown && placed.card?.side === "beside")).toBe(true);
  expect(CARD_BESIDE_OFFSET).toBeGreaterThan(MARKER_SIZE);
});
