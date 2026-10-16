import { expect, test } from "bun:test";
import { flowMarginColumn, MARKER_SIZE, type ColumnEntry } from "./marginCards";

const DOT_STEP = MARKER_SIZE + 6;
const entry = (key: string, anchor: number, mode: ColumnEntry<string>["mode"] = "auto", openedRank?: number, height = 300): ColumnEntry<string> => ({ key, anchor, height, mode, openedRank });

test("in a crowded paragraph the first entry opens and the others are dots below it", () => {
  const layout = flowMarginColumn([entry("a", 0), entry("b", 10), entry("c", 20), entry("d", 2000)]);
  expect(layout).toEqual(new Map([
    ["a", { top: 0, shown: "card", displaced: false }],
    ["b", { top: 312, shown: "dot", displaced: false }],
    ["c", { top: 312 + DOT_STEP, shown: "dot", displaced: false }],
    ["d", { top: 2000, shown: "card", displaced: false }],
  ]));
});

test("opening a dot turns it into a card in place, moves only what is below, and keeps earlier cards still", () => {
  const before = flowMarginColumn([entry("a", 0, "closed"), entry("b", 10), entry("c", 20)]);
  const openedB = flowMarginColumn([entry("a", 0, "closed"), entry("b", 10, "opened", 1), entry("c", 20)]);
  expect(openedB.get("a")).toEqual(before.get("a"));
  expect(openedB.get("b")).toEqual({ top: before.get("b")!.top, shown: "card", displaced: false });
  expect(openedB.get("c")).toEqual({ top: DOT_STEP + 300 + 12, shown: "dot", displaced: false });
  // a then opens too. It takes its place at its words, and b moves to 312,
  // 302 px below its words, so b shows as a dot until a closes.
  const thenA = flowMarginColumn([entry("a", 0, "opened", 2), entry("b", 10, "opened", 1), entry("c", 20)]);
  expect(thenA.get("a")).toEqual({ top: 0, shown: "card", displaced: false });
  expect(thenA.get("b")).toEqual({ top: 312, shown: "dot", displaced: true });
});

test("a card the reader closed stays a dot", () => {
  expect(flowMarginColumn([entry("a", 0, "closed")]).get("a")).toEqual({ top: 0, shown: "dot", displaced: false });
});

test("the newest opened card closes the earlier ones above it that are in its way", () => {
  const entries = [entry("a", 0, "opened", 1), entry("b", 100, "opened", 2), entry("c", 1000, "opened", 3)];
  const layout = flowMarginColumn(entries);
  // b is newer than a and would land at 312 with a open, 212 px below its
  // words, so a closes and b sits at its words. c is far away and stays open.
  expect(layout.get("a")).toEqual({ top: 0, shown: "dot", displaced: true });
  expect(layout.get("b")).toEqual({ top: 100, shown: "card", displaced: false });
  expect(layout.get("c")).toEqual({ top: 1000, shown: "card", displaced: false });
});

test("a card that opened by itself gives way to a card the reader opens below it", () => {
  const layout = flowMarginColumn([entry("a", 0), entry("b", 10), entry("c", 20, "opened", 1)]);
  expect(layout.get("a")).toEqual({ top: 0, shown: "dot", displaced: true });
  // Once a gives way, b would open by itself in its place and push c down
  // too, so b gives way as well.
  expect(layout.get("b")).toEqual({ top: DOT_STEP, shown: "dot", displaced: true });
  expect(layout.get("c")).toEqual({ top: 2 * DOT_STEP, shown: "card", displaced: false });
});

test("a card opens at its home, where its dot sits when every entry is a dot, even below an open card", () => {
  // a is open at 0 and reaches to 300. c's home is two dot steps down, inside
  // a, so opening c closes a and puts c at its home.
  const layout = flowMarginColumn([entry("a", 0, "opened", 1), entry("b", 0), entry("c", 0, "opened", 2)]);
  expect(layout.get("a")).toEqual({ top: 0, shown: "dot", displaced: true });
  expect(layout.get("c")).toEqual({ top: 2 * DOT_STEP, shown: "card", displaced: false });
});
