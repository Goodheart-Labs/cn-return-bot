import { describe, expect, test } from "bun:test";
import { mergeFeedNotes } from "./feedOrder";

describe("mergeFeedNotes", () => {
  test("leads with three helpful notes, then alternates starting with needs-ratings", () => {
    expect(mergeFeedNotes(["h1", "h2", "h3", "h4", "h5"], ["n1", "n2", "n3", "n4"]))
      .toEqual(["h1", "h2", "h3", "n1", "h4", "n2", "h5", "n3", "n4"]);
  });

  test("preserves needs-ratings order when no notes are helpful", () => {
    expect(mergeFeedNotes([], ["n1", "n2", "n3"])).toEqual(["n1", "n2", "n3"]);
  });

  test.each([{ helpful: ["h1"] }, { helpful: ["h1", "h2"] }])("handles fewer than three helpful notes: %j", ({ helpful }) => {
    expect(mergeFeedNotes(helpful, ["n1", "n2"])).toEqual([...helpful, "n1", "n2"]);
  });

  test("preserves helpful order when no notes need ratings", () => {
    expect(mergeFeedNotes(["h1", "h2", "h3", "h4", "h5"], []))
      .toEqual(["h1", "h2", "h3", "h4", "h5"]);
  });

  test("appends remaining helpful notes when needs-ratings runs out", () => {
    expect(mergeFeedNotes(["h1", "h2", "h3", "h4", "h5", "h6"], ["n1", "n2"]))
      .toEqual(["h1", "h2", "h3", "n1", "h4", "n2", "h5", "h6"]);
  });

  test("handles two empty lists", () => {
    expect(mergeFeedNotes([], [])).toEqual([]);
  });

  test("preserves input lists and note objects", () => {
    const helpful = Object.freeze([{ id: "h1" }, { id: "h2" }, { id: "h3" }, { id: "h4" }] as const);
    const needRatings = Object.freeze([{ id: "n1" }] as const);
    const merged = mergeFeedNotes<{ id: string }>(helpful, needRatings);
    expect(merged).toEqual([helpful[0], helpful[1], helpful[2], needRatings[0], helpful[3]]);
    expect(merged[0]).toBe(helpful[0]);
    expect(merged[3]).toBe(needRatings[0]);
  });
});
