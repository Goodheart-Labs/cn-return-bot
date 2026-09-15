import { describe, expect, test } from "bun:test";
import { computeHeadlineMetrics, computeHelpfulNoteShare, sortNotesForList } from "./aggregations";
import type { NoteRecord } from "./types";

const note = (id: string, views: number | null, status: NoteRecord["cn_status"] = "CURRENTLY_RATED_HELPFUL"): NoteRecord => ({
  note_id: id, tweet_id: id, submitted_at: "2026-09-01T00:00:00Z", cn_status: status,
  view_count: views, helpful_count: 0, not_helpful_count: 0, rating_count: 0,
  note_text: "A correction", ab_test_picks: null, cost: null, tweet: null,
  public_dump_ratings: null, failure_modes: null,
});

describe("public impact", () => {
  test("uses matched platform counts across the stated dates, weighted by note count", () => {
    expect(computeHelpfulNoteShare([
      { day: "2026-09-02", helpful_ours: 9, helpful_total: 90, helpful_other_ai: 4 },
      { day: "2026-09-01", helpful_ours: 5, helpful_total: 10, helpful_other_ai: 1 },
    ])).toEqual({ ours: 14, total: 100, proportion: 0.14, firstDay: "2026-09-01", lastDay: "2026-09-02" });
  });

  test("does not invent a percentage when platform counts are missing or inconsistent", () => {
    expect(computeHelpfulNoteShare([])).toBeNull();
    for (const [ours, total] of [[0, 0], [2, 1], [-1, 10], [1, NaN], [1, Infinity]]) {
      expect(computeHelpfulNoteShare([
        { day: "2026-09-01", helpful_ours: ours!, helpful_total: total!, helpful_other_ai: 0 },
      ])).toBeNull();
    }
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
