// The data behind the A/B comparison panel. It takes the pipeline data, keeps
// only the A/B tests the user picked, groups the rows by the combination of
// variants they ran with, and gives every combination a metric interval. The
// grouping follows the same style as aggregations.ts.
//
// There is one trap here. Two different sources feed the counts. The note
// records give the helpful, unhelpful and needs-more-ratings counts. The run
// outcome aggregates give the total and candidate counts. The two are counted
// in separate passes and are never mixed inside one fraction. A submitted run
// can have no note row with a submission time, and a note row can have no
// matching run, so the two denominators can differ slightly.

import type { AbOutcomeAggregate, NoteRecord } from "./types";
import { matchesAbFilters, type ABFilters } from "../../../dashboard-shared/abFilters";
import { humanizeTagName, isNegativeRatingReason } from "../../../dashboard-shared/ratingReasons";
import { costPerCountCI, proportionCI, proportionDiffCI, type Interval } from "./confidenceIntervals";

// The five metrics that take no parameter.
export type BaseStatKind =
  | "pct_helpful"
  | "pct_unhelpful"
  | "pct_helpful_minus_unhelpful"
  | "pct_candidate"
  | "cost_per_helpful";

// The metric the comparison is drawn against. Two of them take a parameter. A
// failure-mode metric names a tag and measures the share of reviewed notes that
// carry it. A rating-reason metric names a reason and measures the share of the
// ratings of that polarity which cite it.
export type AbComparisonStat =
  | { kind: BaseStatKind }
  | { kind: "failure_mode"; tag: string }
  | { kind: "rating_type"; reason: string };

// How the values of a metric read on the axis. A percent is a share between 0
// and 100. A diff is a signed difference around zero. A cost is an amount of
// money.
export type AbStatKind = "percent" | "diff" | "cost";

export interface AbComboCounts {
  helpful: number;
  unhelpful: number;
  nmr: number;
  candidate: number; // Comes from the run aggregates.
  total: number; // Runs that have finished, from the run aggregates.
  cost: number; // Cost added up over the finished runs.
  // The rating-reason metric divides a reason's count by all the ratings of the
  // same polarity.
  positiveRatings: number; // Helpful and somewhat-helpful ratings together.
  negativeRatings: number; // Not-helpful ratings.
  ratingReasonCounts: Record<string, number>; // Both tag maps merged into one.
  // The failure-mode metric divides the notes carrying a tag by the notes that
  // somebody has reviewed.
  reviewedNotes: number;
  failureModeCounts: Record<string, number>;
}

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
    positiveRatings: 0,
    negativeRatings: 0,
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
      counts.positiveRatings += rating.helpful_count + rating.somewhat_helpful_count;
      counts.negativeRatings += rating.not_helpful_count;
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

/**
 * Turn a combination's counts and the chosen metric into an interval and the
 * sample size behind it. Returns null when the sample size is zero, and the
 * caller then draws a "no data" row.
 *
 * By default the denominator is the submitted notes. It becomes every finished
 * run when includeNonCandidate is set.
 * Four metrics ignore that setting. pct_candidate always divides by every run.
 * cost_per_helpful always divides the cost of every run by the number of
 * helpful notes. The failure-mode metric divides by the reviewed notes, and the
 * rating-type metric divides by the ratings of one polarity.
 * `n` is the sample size the interval is computed from. For the cost metric
 * that is the helpful-note count.
 */
export function statInterval(
  counts: AbComboCounts,
  stat: AbComparisonStat,
  includeNonCandidate: boolean,
  z: number,
): { interval: Interval; n: number } | null {
  const nSubmitted = counts.helpful + counts.unhelpful + counts.nmr;
  const nAll = counts.total;

  switch (stat.kind) {
    case "pct_candidate": {
      if (nAll === 0) return null;
      return { interval: proportionCI(counts.candidate, nAll, z), n: nAll };
    }
    case "cost_per_helpful": {
      if (counts.helpful === 0 || counts.cost <= 0) return null;
      return { interval: costPerCountCI(counts.cost, counts.helpful, z), n: counts.helpful };
    }
    case "failure_mode": {
      const n = counts.reviewedNotes;
      if (n === 0) return null;
      return { interval: proportionCI(counts.failureModeCounts[stat.tag] ?? 0, n, z), n };
    }
    case "rating_type": {
      const n = isNegativeRatingReason(stat.reason) ? counts.negativeRatings : counts.positiveRatings;
      if (n === 0) return null;
      return { interval: proportionCI(counts.ratingReasonCounts[stat.reason] ?? 0, n, z), n };
    }
    default: {
      const n = includeNonCandidate ? nAll : nSubmitted;
      if (n === 0) return null;
      if (stat.kind === "pct_helpful") return { interval: proportionCI(counts.helpful, n, z), n };
      if (stat.kind === "pct_unhelpful") return { interval: proportionCI(counts.unhelpful, n, z), n };
      // The only kind left is pct_helpful_minus_unhelpful.
      return { interval: proportionDiffCI(counts.helpful, counts.unhelpful, n, z), n };
    }
  }
}

export function statKind(stat: AbComparisonStat): AbStatKind {
  if (stat.kind === "pct_helpful_minus_unhelpful") return "diff";
  if (stat.kind === "cost_per_helpful") return "cost";
  return "percent";
}

// These stats inherently span all runs, so the "include non-candidate runs"
// toggle is forced on and disabled for them.
export function forcesAllRuns(stat: AbComparisonStat): boolean {
  return stat.kind === "pct_candidate" || stat.kind === "cost_per_helpful";
}

// Lower is better for the cost metric. It is also better for failure modes,
// where fewer flaws is good, and for negative rating reasons, where fewer
// complaints is good. This only decides the row order, with the best on top.
export function lowerIsBetter(stat: AbComparisonStat): boolean {
  if (stat.kind === "cost_per_helpful") return true;
  if (stat.kind === "failure_mode") return true;
  if (stat.kind === "rating_type") return isNegativeRatingReason(stat.reason);
  return false;
}

const BASE_STAT_LABELS: Record<BaseStatKind, string> = {
  pct_helpful: "Percent Helpful",
  pct_unhelpful: "Percent Unhelpful",
  pct_helpful_minus_unhelpful: "Percent Helpful − Unhelpful",
  pct_candidate: "Percent of Candidate Runs out of all runs",
  cost_per_helpful: "Cost per Helpful Note",
};

// The flat metrics, in menu order.
export const BASE_STAT_OPTIONS = Object.keys(BASE_STAT_LABELS) as BaseStatKind[];

export function statLabel(stat: AbComparisonStat): string {
  if (stat.kind === "failure_mode") return `Failure mode: ${stat.tag}`;
  if (stat.kind === "rating_type") return `Rating type: ${humanizeTagName(stat.reason)}`;
  return BASE_STAT_LABELS[stat.kind];
}

// One failure-mode tag or rating reason, together with how often it was seen.
// These fill the metric submenus.
export interface ReasonUsage {
  name: string;
  count: number;
}

// Rating reasons split by polarity for the Rating Type submenu.
export interface RatingReasonCatalog {
  positive: ReasonUsage[];
  negative: ReasonUsage[];
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

// The window options the comparison panel offers. A null means all time.
export const WINDOW_DAY_OPTIONS: (number | null)[] = [null, 7, 14, 30, 90];

export function windowLabel(days: number | null): string {
  return days === null ? "All time" : `Last ${days} days`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The first UTC day of a "last N days" window, written as YYYY-MM-DD. Rows on
// that day or after it are kept. A null window returns null, which keeps
// everything.
export function windowStartDate(days: number | null): string | null {
  if (days === null) return null;
  return new Date(Date.now() - days * MS_PER_DAY).toISOString().slice(0, 10);
}
