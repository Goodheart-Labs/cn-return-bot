import { describe, expect, test } from "bun:test";
import type { NoteRow } from "@cn/core/types";
import { contentOrder, mergeFeedNotes, notesByItem, rankFeed, tallyOf } from "./feed";

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

/** A note on its own claim, with the given counts. Only the fields the
 *  ordering reads matter. */
function note(id: string, counts: { h?: number; s?: number; n?: number } = {}, extra: Partial<NoteRow> = {}, claim: Partial<NoteRow["claim"]> = {}): NoteRow {
  return {
    id,
    claim_id: `claim-${id}`,
    note: "",
    sources: [],
    has_source_details: false,
    helpful_count: counts.h ?? 0,
    somewhat_helpful_count: counts.s ?? 0,
    not_helpful_count: counts.n ?? 0,
    author_id: null,
    author_name: null,
    improved_from_note_id: null,
    status: "published",
    created_at: "2026-09-01T00:00:00Z",
    claim: {
      id: `claim-${id}`,
      item_id: "item",
      claim: "",
      context_quote: null,
      context_paragraph: null,
      image_urls: [],
      updated_quote: null,
      context_url: null,
      start_seconds: null,
      end_seconds: null,
      ...claim,
    },
    ...extra,
  };
}

const ids = (notes: NoteRow[]) => notes.map((n) => n.id);

describe("rankFeed", () => {
  test("puts helpful notes first, most certain first, and mixes in notes that need ratings", () => {
    const feed = rankFeed([note("unrated"), note("helpful", { h: 3 }), note("very-helpful", { h: 6 })], tallyOf);
    expect(ids(feed.leading)).toEqual(["very-helpful", "helpful", "unrated"]);
  });

  test("sends unhelpful notes to their own section", () => {
    const feed = rankFeed([note("bad", { n: 3 }), note("unrated")], tallyOf);
    expect(ids(feed.leading)).toEqual(["unrated"]);
    expect(ids(feed.unhelpful)).toEqual(["bad"]);
  });

  test("drops a note on edited source text to the bottom, whatever its rating", () => {
    const feed = rankFeed([note("stale", { h: 6 }, {}, { updated_quote: "new wording" }), note("unrated")], tallyOf);
    expect(ids(feed.leading)).toEqual(["unrated"]);
    expect(ids(feed.staleSource)).toEqual(["stale"]);
  });

  test("ranks by the tallies it is given, not the live ones", () => {
    const frozen = new Map([["now-helpful", { helpful_count: 0, somewhat_helpful_count: 0, not_helpful_count: 0 }]]);
    const feed = rankFeed([note("now-helpful", { h: 6 })], (n) => frozen.get(n.id) ?? tallyOf(n));
    expect(feed.unhelpful).toEqual([]);
    expect(ids(feed.leading)).toEqual(["now-helpful"]);
  });
});

describe("contentOrder", () => {
  test("follows the clip timestamps and keeps an improvement behind its original", () => {
    const original = note("original", {}, { created_at: "2026-09-02T00:00:00Z" }, { start_seconds: 60 });
    const improvement = note("improvement", {}, { improved_from_note_id: "original", created_at: "2026-09-01T00:00:00Z" }, { start_seconds: 60 });
    const earlier = note("earlier", {}, {}, { start_seconds: 10 });
    const all = [improvement, original, earlier];
    const byId = new Map(all.map((n) => [n.id, n]));
    const items = [{ id: "item", project_id: "p", url: "", title: null, published_at: null, created_at: "" }];
    expect(ids(contentOrder(items, notesByItem(all), byId))).toEqual(["earlier", "original", "improvement"]);
  });
});
