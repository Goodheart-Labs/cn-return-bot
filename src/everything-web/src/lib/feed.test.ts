import { describe, expect, test } from "bun:test";
import type { FeedSummary } from "@cn/core/feedPages";
import type { NoteRow } from "@cn/core/types";
import { ageLabel, ageTotal, BAND_LABELS, bandTotal, improvementsByOriginal, sectionsOf, spanStarts } from "./feed";

/* The order of the feed is decided in the database and tested in
 * migrations/141_paged_lists.verify.sql. These tests cover what the browser
 * still does with the notes it has loaded. */

const summary = (matching: number, since: number[], bands = { main: 0, unhelpful: 0, stale: 0 }): FeedSummary => ({
  matching,
  since,
  bands,
  largest: { views: 0, votes: 0, helpful: 0, notHelpful: 0 },
});

describe("sectionsOf", () => {
  const label = (entry: string) => (entry.startsWith("u") ? "Unhelpful notes" : null);

  test("puts neighbouring entries with the same label into one band", () => {
    expect(sectionsOf(["a", "b", "u1", "u2"], label, () => 7)).toEqual([
      { label: null, total: null, entries: ["a", "b"] },
      { label: "Unhelpful notes", total: 7, entries: ["u1", "u2"] },
    ]);
  });

  test("a band that continues on the next page stays one band", () => {
    const firstPage = ["a", "u1"];
    const secondPage = ["u2"];
    expect(sectionsOf([...firstPage, ...secondPage], label, () => null).map((s) => s.entries)).toEqual([["a"], ["u1", "u2"]]);
  });
});

describe("the mixed order's dividers", () => {
  test("name the unhelpful and stale bands and count them from the summary", () => {
    const counts = summary(10, [], { main: 7, unhelpful: 2, stale: 1 });
    expect(bandTotal(counts, BAND_LABELS.unhelpful!)).toBe(2);
    expect(bandTotal(counts, BAND_LABELS.stale!)).toBe(1);
    expect(bandTotal(undefined, BAND_LABELS.stale!)).toBeNull();
  });
});

describe("the newest order's dividers", () => {
  // Noon on 2026-10-20 in the test machine's own time zone, like the reader's.
  const starts = spanStarts(new Date(2026, 9, 20, 12));
  const at = (...date: [number, number, number, number]) => new Date(...date).toISOString();

  test("label each note by the span of days it was written in", () => {
    expect([
      at(2026, 9, 20, 1),
      at(2026, 9, 19, 23),
      at(2026, 9, 14, 0),
      at(2026, 9, 13, 23),
      at(2026, 8, 21, 0),
      at(2025, 9, 21, 0),
      at(2025, 9, 20, 23),
    ].map((createdAt) => ageLabel(createdAt, starts))).toEqual([
      "Today",
      "Yesterday",
      "Last 7 days",
      "Last 30 days",
      "Last 30 days",
      "Last 365 days",
      "Older",
    ]);
  });

  test("count each span as the difference of the counts since its start and since the next", () => {
    // 2 notes today, 5 since yesterday, 9 in 7 days, 12 in 30, 20 in 365, 26 in all.
    const counts = summary(26, [2, 5, 9, 12, 20]);
    expect(["Today", "Yesterday", "Last 7 days", "Last 30 days", "Last 365 days", "Older"].map((label) => ageTotal(counts, label))).toEqual([2, 3, 4, 3, 8, 6]);
  });
});

describe("improvementsByOriginal", () => {
  const note = (id: string, improvedFrom: string | null) => ({ id, improved_from_note_id: improvedFrom }) as NoteRow;

  test("lists each note's improvements among the loaded notes", () => {
    const byOriginal = improvementsByOriginal([note("a", null), note("b", "a"), note("c", "a"), note("d", "b")]);
    expect(byOriginal.get("a")?.map((n) => n.id)).toEqual(["b", "c"]);
    expect(byOriginal.get("b")?.map((n) => n.id)).toEqual(["d"]);
    expect(byOriginal.has("c")).toBe(false);
  });
});
