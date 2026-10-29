// The data behind the A/B comparison panel. It takes the pipeline data, keeps
// only the A/B tests the user picked, groups the rows by the combination of
// variants they ran with, and gives every combination a metric interval. The
// grouping follows the same style as aggregations.ts.
//
// There is one trap here. Two different sources feed the counts. The note
// records give the helpful, unhelpful and needs-more-ratings counts, and the
// individual ratings each note collected. The run outcome aggregates give the
// total and candidate counts. The two are counted in separate passes and are
// never mixed inside one fraction. A submitted run can have no note row with a
// submission time, and a note row can have no matching run, so the two
// denominators can differ slightly.

import type { AbOutcomeAggregate, NoteRecord } from "./types";
import { matchesAbFilters, type ABFilters } from "../../../dashboard-shared/abFilters";
import type { AbComboCounts, RatingReasonCatalog, ReasonUsage } from "../../../everything-core/abStats";
import { isNegativeRatingReason } from "../../../everything-core/ratingReasons";

export interface AbCombo {
  key: string; // Built in dimension order, so it stays the same across renders.
  picks: Record<string, string>; // Only the picks for the selected dimensions.
  label: string; // For example "search=grok43-native · prompts=detailed".
  counts: AbComboCounts;
}

/**
 * Cut a full set of picks down to the selected dimensions.
 * Returns null when the record has no pick for one of them. Such a record is
 * left out of the split, because a run that never set a test cannot be compared
 * on that test.
 */
function projectPicks(
  picks: Record<string, string> | null | undefined,
  dims: string[],
): Record<string, string> | null {
  if (!picks) return null;
  const out: Record<string, string> = {};
  for (const dim of dims) {
    const value = picks[dim];
    if (value === undefined) return null;
    out[dim] = value;
  }
  return out;
}

function comboKey(projected: Record<string, string>, dims: string[]): string {
  return dims.map((dim) => `${dim}=${projected[dim]}`).join(" ");
}

function comboLabel(projected: Record<string, string>, dims: string[]): string {
  return dims.map((dim) => `${dim}=${projected[dim]}`).join(" · ");
}

function emptyCounts(): AbComboCounts {
  return {
    helpful: 0,
    unhelpful: 0,
    nmr: 0,
    candidate: 0,
    total: 0,
    cost: 0,
    helpfulRatings: 0,
    somewhatHelpfulRatings: 0,
    notHelpfulRatings: 0,
    ratingReasonCounts: {},
    reviewedNotes: 0,
    failureModeCounts: {},
  };
}

function accumulateReasonCounts(into: Record<string, number>, from: Record<string, number>): void {
  for (const [reason, count] of Object.entries(from)) {
    into[reason] = (into[reason] ?? 0) + count;
  }
}

/**
 * Apply the panel's A/B filters, then group the notes and the run aggregates by
 * the combination of variants they used on the selected dimensions. Returns one
 * AbCombo per combination that actually occurs. The result is sorted by label,
 * so the rows keep their order when the user switches to another metric.
 */
export function buildAbCombos(
  notes: NoteRecord[],
  outcomeAggs: AbOutcomeAggregate[],
  dims: string[],
  filters: ABFilters,
  sinceDate: string | null,
): AbCombo[] {
  if (dims.length === 0) return [];
  const byKey = new Map<string, AbCombo>();

  const getOrCreate = (projected: Record<string, string>): AbCombo => {
    const key = comboKey(projected, dims);
    let combo = byKey.get(key);
    if (!combo) {
      combo = { key, picks: projected, label: comboLabel(projected, dims), counts: emptyCounts() };
      byKey.set(key, combo);
    }
    return combo;
  };

  // First pass, over the notes. It counts helpful, unhelpful and
  // needs-more-ratings, using the same branches as bucketize.
  for (const note of notes) {
    if (sinceDate && note.submitted_at.slice(0, 10) < sinceDate) continue;
    if (!matchesAbFilters(note.ab_test_picks, filters)) continue;
    const projected = projectPicks(note.ab_test_picks, dims);
    if (!projected) continue;
    const counts = getOrCreate(projected).counts;
    if (note.cn_status === "CURRENTLY_RATED_HELPFUL") counts.helpful++;
    else if (note.cn_status === "CURRENTLY_RATED_NOT_HELPFUL") counts.unhelpful++;
    else counts.nmr++;

    const rating = note.public_dump_ratings;
    if (rating) {
      counts.helpfulRatings += rating.helpful_count;
      counts.somewhatHelpfulRatings += rating.somewhat_helpful_count;
      counts.notHelpfulRatings += rating.not_helpful_count;
      accumulateReasonCounts(counts.ratingReasonCounts, rating.helpful_tag_counts);
      accumulateReasonCounts(counts.ratingReasonCounts, rating.not_helpful_tag_counts);
    }

    // A note that nobody has reviewed has failure_modes set to null. Only
    // reviewed notes count towards the failure-mode denominator.
    if (note.failure_modes !== null) {
      counts.reviewedNotes++;
      for (const tag of note.failure_modes) {
        counts.failureModeCounts[tag] = (counts.failureModeCounts[tag] ?? 0) + 1;
      }
    }
  }

  // Second pass, over the run aggregates. It fills in the candidate and total
  // denominators.
  for (const agg of outcomeAggs) {
    if (sinceDate && agg.date < sinceDate) continue;
    if (!matchesAbFilters(agg.ab_test_picks, filters)) continue;
    const projected = projectPicks(agg.ab_test_picks, dims);
    if (!projected) continue;
    const counts = getOrCreate(projected).counts;
    counts.candidate += agg.candidate;
    counts.total += agg.total;
    counts.cost += agg.cost;
  }

  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function sortByCountDesc(counts: Map<string, number>): ReasonUsage[] {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// The failure-mode tags seen on reviewed notes, most common first. A tag that
// never occurs would read as 0% on every row, so only tags that do occur are
// offered.
export function buildFailureModeCatalog(notes: NoteRecord[]): ReasonUsage[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    if (!note.failure_modes) continue;
    for (const tag of note.failure_modes) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return sortByCountDesc(counts);
}

// The rating reasons seen in the notes' public-dump tag counts, split by
// polarity and most common first. The list is derived from the data, so the
// submenu always matches the Ratings table.
export function buildRatingReasonCatalog(notes: NoteRecord[]): RatingReasonCatalog {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const rating = note.public_dump_ratings;
    if (!rating) continue;
    for (const [reason, c] of Object.entries(rating.helpful_tag_counts)) counts.set(reason, (counts.get(reason) ?? 0) + c);
    for (const [reason, c] of Object.entries(rating.not_helpful_tag_counts)) counts.set(reason, (counts.get(reason) ?? 0) + c);
  }
  const all = sortByCountDesc(counts);
  return {
    positive: all.filter((r) => !isNegativeRatingReason(r.name)),
    negative: all.filter((r) => isNegativeRatingReason(r.name)),
  };
}

