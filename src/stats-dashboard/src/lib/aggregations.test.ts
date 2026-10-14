import { describe, expect, test } from "bun:test";
import { computeHeadlineMetrics, selectHighImpactNotes, sortNotesForList } from "./aggregations";
import type { NoteRecord } from "./types";

const note = (id: string, views: number | null, status: NoteRecord["cn_status"] = "CURRENTLY_RATED_HELPFUL"): NoteRecord => ({
  note_id: id, tweet_id: id, submitted_at: "2026-09-01T00:00:00Z", cn_status: status,
  view_count: views, helpful_count: 0, not_helpful_count: 0, rating_count: 0,
  note_text: "A correction", ab_test_picks: null, cost: null, tweet: null,
  public_dump_ratings: null, failure_modes: null,
});

describe("public impact", () => {
  test("uses the starred selection regardless of rating, ordered by views", () => {
    const notes = [
      { ...note("starred-helpful", 50), high_value: true },
      { ...note("unstarred-helpful", 10000), high_value: false },
      { ...note("starred-pending", 100, "NEEDS_MORE_RATINGS"), high_value: true },
      { ...note("starred-unhelpful", 10, "CURRENTLY_RATED_NOT_HELPFUL"), high_value: true },
    ];
    expect(selectHighImpactNotes(notes).map((n) => n.note_id)).toEqual(["starred-pending", "starred-helpful", "starred-unhelpful"]);
    expect(notes[0]?.note_id).toBe("starred-helpful");
  });

  test("missing stars do not enter the public selection; unknown views sort after zero", () => {
    expect(selectHighImpactNotes([note("legacy", 500)])).toEqual([]);
    const notes = [
      { ...note("unknown", null), high_value: true },
      { ...note("zero", 0), high_value: true },
    ];
    expect(selectHighImpactNotes(notes).map((n) => n.note_id)).toEqual(["zero", "unknown"]);
  });

  test("ranks only Helpful notes by views, keeping unknown views distinct from zero", () => {
    const notes = [note("unknown", null), note("zero", 0), note("low", 10), note("unhelpful", 5000, "CURRENTLY_RATED_NOT_HELPFUL"), note("high", 1000)];
    expect(sortNotesForList(notes, "most_views_helpful").map((n) => n.note_id)).toEqual(["high", "low", "zero", "unknown"]);
    expect(notes[0]?.note_id).toBe("unknown");
    const metrics = computeHeadlineMetrics(notes, [], {});
    expect(metrics.viewsOnHelpful).toBe(1010);
    expect(metrics.helpfulNotes).toBe(4);
    expect(metrics.helpfulNotesWithViews).toBe(3);
    expect(metrics.totalViews).toBe(6010);
  });
});
