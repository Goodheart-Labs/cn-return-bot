import { describe, expect, test } from "bun:test";
import type { NoteRow } from "@cn/core/types";
import { arrangeFeed, contentOrder, DEFAULT_NOTE_FILTERS, feedLength, filterNotes, firstNotes, matchesAuthor, mergeFeedNotes, noteAuthors, notesByItem, personFilter, rankFeed, tallyOf, type FeedSection } from "./feed";

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
    const [leading] = rankFeed([note("unrated"), note("helpful", { h: 3 }), note("very-helpful", { h: 6 })], tallyOf);
    expect(ids(leading!.notes)).toEqual(["very-helpful", "helpful", "unrated"]);
  });

  test("sends unhelpful notes to their own section", () => {
    const [leading, unhelpful] = rankFeed([note("bad", { n: 3 }), note("unrated")], tallyOf);
    expect(ids(leading!.notes)).toEqual(["unrated"]);
    expect(ids(unhelpful!.notes)).toEqual(["bad"]);
  });

  test("drops a note on edited source text to the bottom, whatever its rating", () => {
    const [leading, , staleSource] = rankFeed([note("stale", { h: 6 }, {}, { updated_quote: "new wording" }), note("unrated")], tallyOf);
    expect(ids(leading!.notes)).toEqual(["unrated"]);
    expect(ids(staleSource!.notes)).toEqual(["stale"]);
  });

  test("ranks by the tallies it is given, not the live ones", () => {
    const frozen = new Map([["now-helpful", { helpful_count: 0, somewhat_helpful_count: 0, not_helpful_count: 0 }]]);
    const [leading, unhelpful] = rankFeed([note("now-helpful", { h: 6 })], (n) => frozen.get(n.id) ?? tallyOf(n));
    expect(unhelpful!.notes).toEqual([]);
    expect(ids(leading!.notes)).toEqual(["now-helpful"]);
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

describe("arrangeFeed", () => {
  const bad = note("bad", { n: 3 }, { created_at: "2026-09-03T00:00:00Z" });
  const stale = note("stale", { h: 6 }, { created_at: "2026-09-01T00:00:00Z" }, { updated_quote: "new wording" });
  const unrated = note("unrated", {}, { created_at: "2026-09-02T00:00:00Z" });
  const helpful = note("helpful", { h: 3 }, { created_at: "2026-09-01T00:00:00Z" });

  // Noon on 2026-10-20 in the test machine's own time zone, like the reader's.
  const now = new Date(2026, 9, 20, 12);
  /** The bands that hold notes, as their labels and note ids. */
  const bands = (sections: FeedSection[]) => sections.filter((s) => s.notes.length > 0).map((s) => [s.label, ids(s.notes)]);

  test("the mixed order is the project page's order, with its bands", () => {
    expect(arrangeFeed([bad, stale, unrated, helpful], "mixed", tallyOf, now)).toEqual(rankFeed([bad, stale, unrated, helpful], tallyOf));
  });

  test("the recent order lists every note newest first, under one band per span of time", () => {
    const at = (id: string, ...date: [number, number, number, number]) => note(id, {}, { created_at: new Date(...date).toISOString() });
    const notes = [
      at("this-morning", 2026, 9, 20, 1),
      at("last-night", 2026, 9, 19, 23),
      at("six-days-back", 2026, 9, 14, 0),
      at("seven-days-back", 2026, 9, 13, 23),
      at("29-days-back", 2026, 8, 21, 0),
      at("last-year", 2025, 9, 21, 0),
      at("long-ago", 2025, 9, 20, 23),
    ];
    expect(bands(arrangeFeed([...notes].reverse(), "recent", tallyOf, now))).toEqual([
      ["Today", ["this-morning"]],
      ["Yesterday", ["last-night"]],
      ["Last 7 days", ["six-days-back"]],
      ["Last 30 days", ["seven-days-back", "29-days-back"]],
      ["Last 365 days", ["last-year"]],
      ["Older", ["long-ago"]],
    ]);
  });

  test("the recent order breaks a tie in age by content order", () => {
    expect(bands(arrangeFeed([helpful, stale, unrated, bad], "recent", tallyOf, now))).toEqual([["Last 365 days", ["bad", "unrated", "helpful", "stale"]]]);
  });

  test("the helpful order lists every note by its chance of being helpful, without bands", () => {
    expect(bands(arrangeFeed([bad, unrated, helpful, stale], "helpful", tallyOf, now))).toEqual([[null, ["stale", "helpful", "unrated", "bad"]]]);
  });

  test("the helpful order ranks by the tallies it is given, not the live ones", () => {
    const frozen = new Map([["helpful", { helpful_count: 0, somewhat_helpful_count: 0, not_helpful_count: 0 }]]);
    const feed = arrangeFeed([unrated, helpful, stale], "helpful", (n) => frozen.get(n.id) ?? tallyOf(n), now);
    expect(bands(feed)).toEqual([[null, ["stale", "unrated", "helpful"]]]);
  });
});

describe("firstNotes", () => {
  const sections = [
    { label: null, notes: [note("l1"), note("l2")] },
    { label: "Unhelpful notes", notes: [note("u1"), note("u2")] },
    { label: "Source has since changed", notes: [note("s1")] },
  ];

  test("takes the bands' notes in the order they render", () => {
    expect(firstNotes(sections, 3).map((s) => ids(s.notes))).toEqual([["l1", "l2"], ["u1"], []]);
    expect(feedLength(firstNotes(sections, 5))).toBe(5);
  });

  test("a count past the end returns the whole feed", () => {
    expect(firstNotes(sections, 100)).toEqual(sections);
  });
});

describe("filterNotes", () => {
  const seen = note("seen", {}, {}, { item_id: "popular" });
  const unseen = note("unseen", {}, {}, { item_id: "quiet" });
  const voted = note("voted", { h: 2, s: 1, n: 3 }, {}, { item_id: "popular" });
  const viewsOf = (n: NoteRow) => (n.claim.item_id === "popular" ? 7 : 0);
  const filter = (filters: Partial<typeof DEFAULT_NOTE_FILTERS>) =>
    filterNotes([seen, unseen, voted], { ...DEFAULT_NOTE_FILTERS, ...filters }, viewsOf, tallyOf).map((n) => n.id);

  test("by default keeps only notes on posts at least 5 readers saw", () => {
    expect(filter({})).toEqual(["seen", "voted"]);
  });

  test("all minimums at zero keep every note", () => {
    expect(filter({ views: 0 })).toEqual(["seen", "unseen", "voted"]);
  });

  test("votes count all three kinds of vote", () => {
    expect(filter({ views: 0, votes: 6 })).toEqual(["voted"]);
    expect(filter({ views: 0, votes: 7 })).toEqual([]);
  });

  test("helpful and not helpful minimums read their own count", () => {
    expect(filter({ views: 0, helpful: 2, notHelpful: 3 })).toEqual(["voted"]);
    expect(filter({ views: 0, helpful: 3 })).toEqual([]);
  });

  test("reads votes from the tally it is given, not the live counts", () => {
    const frozen = () => ({ helpful_count: 0, somewhat_helpful_count: 0, not_helpful_count: 0 });
    expect(filterNotes([voted], { ...DEFAULT_NOTE_FILTERS, views: 0 }, viewsOf, frozen)).toEqual([voted]);
    expect(filterNotes([voted], { ...DEFAULT_NOTE_FILTERS, views: 0, votes: 1 }, viewsOf, frozen)).toEqual([]);
  });
});

describe("author filter", () => {
  const ai = note("ai");
  const nathanOld = note("n1", {}, { author_id: "nathan", author_name: "Nathan", created_at: "2026-10-01T00:00:00Z" });
  const nathanNew = note("n2", {}, { author_id: "nathan", author_name: "NathanpmYoung", created_at: "2026-10-21T00:00:00Z" });
  const other = note("o1", {}, { author_id: "other", author_name: "" });
  const all = [ai, nathanOld, nathanNew, other];

  test("keeps the notes of the chosen kind of author or person", () => {
    expect(all.filter((n) => matchesAuthor(n, "anyone")).map((n) => n.id)).toEqual(["ai", "n1", "n2", "o1"]);
    expect(all.filter((n) => matchesAuthor(n, "ai")).map((n) => n.id)).toEqual(["ai"]);
    expect(all.filter((n) => matchesAuthor(n, "people")).map((n) => n.id)).toEqual(["n1", "n2", "o1"]);
    expect(all.filter((n) => matchesAuthor(n, personFilter("nathan"))).map((n) => n.id)).toEqual(["n1", "n2"]);
  });

  test("lists each person once, under the name on their newest note, most notes first", () => {
    expect(noteAuthors(all)).toEqual([
      { id: "nathan", name: "NathanpmYoung", noteCount: 2 },
      { id: "other", name: "Anonymous", noteCount: 1 },
    ]);
  });
});
