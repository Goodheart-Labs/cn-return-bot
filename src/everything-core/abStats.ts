// The metrics of the X notewriter page's A/B comparison, and their confidence
// intervals. A combination of A/B arms has counts of notes and of runs, and
// each metric turns those counts into an interval. Both the X notewriter page
// on the website and the old stats page on GitHub Pages use this file.
//
// Two sources feed the counts. The notes give the helpful, unhelpful and
// needs-more-ratings counts, and the ratings each note collected. The runs give
// the total and candidate counts. They are never mixed inside one fraction. A
// submitted run can have no note row with a submission time, and a note row
// can have no matching run, so the two denominators can differ slightly.

import { humanizeTagName, isNegativeRatingReason } from "./ratingReasons";
import { costPerCountCI, proportionCI, proportionDiffCI, type Interval } from "./confidenceIntervals";

// The six metrics that take no parameter.
export type BaseStatKind =
  | "pct_helpful"
  | "pct_unhelpful"
  | "pct_helpful_minus_unhelpful"
  | "pct_helpful_ratings"
  | "pct_candidate"
  | "cost_per_helpful";

// A rater can call a note helpful, somewhat helpful or not helpful. The
// helpful-ratings metric counts a somewhat-helpful rating as half a helpful
// one. That is the weight X's own scoring gives it.
const SOMEWHAT_HELPFUL_RATING_WEIGHT = 0.5;

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
  // The individual ratings the notes collected, from X's public data dump. The
  // helpful-ratings metric pools them over every note in the combination. The
  // rating-reason metric divides a reason's count by all the ratings of the
  // same polarity, where helpful and somewhat helpful together are positive.
  helpfulRatings: number;
  somewhatHelpfulRatings: number;
  notHelpfulRatings: number;
  ratingReasonCounts: Record<string, number>; // Both tag maps merged into one.
  // The failure-mode metric divides the notes carrying a tag by the notes that
  // somebody has reviewed.
  reviewedNotes: number;
  failureModeCounts: Record<string, number>;
}

/**
 * Turn a combination's counts and the chosen metric into an interval and the
 * sample size behind it. Returns null when the sample size is zero, and the
 * caller then draws a "no data" row.
 *
 * By default the denominator is the submitted notes. It becomes every finished
 * run when includeNonCandidate is set.
 * Five metrics ignore that setting. pct_candidate always divides by every run.
 * cost_per_helpful always divides the cost of every run by the number of
 * helpful notes. The failure-mode metric divides by the reviewed notes. The
 * rating-type metric divides by the ratings of one polarity, and the
 * helpful-ratings metric by all ratings, with a somewhat-helpful rating
 * weighted as half a helpful one in the numerator.
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
      const n = isNegativeRatingReason(stat.reason)
        ? counts.notHelpfulRatings
        : counts.helpfulRatings + counts.somewhatHelpfulRatings;
      if (n === 0) return null;
      return { interval: proportionCI(counts.ratingReasonCounts[stat.reason] ?? 0, n, z), n };
    }
    case "pct_helpful_ratings": {
      const n = counts.helpfulRatings + counts.somewhatHelpfulRatings + counts.notHelpfulRatings;
      if (n === 0) return null;
      const weightedHelpful = counts.helpfulRatings + SOMEWHAT_HELPFUL_RATING_WEIGHT * counts.somewhatHelpfulRatings;
      return { interval: proportionCI(weightedHelpful, n, z), n };
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
  pct_helpful_ratings: "Percent Helpful Ratings (somewhat = ½)",
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

/** The range of the axis that every row of a comparison shares. */
export interface Domain {
  min: number;
  max: number;
}

/**
 * Work out the x-axis range that all the visible rows share.
 * For a percent or a cost metric the range follows the data. It never drops
 * below zero, and a percent never goes above one.
 * For a difference metric the range is symmetric around zero.
 * Either way a little padding is added, so the blocks never touch the edges.
 */
export function computeDomain(intervals: Interval[], kind: AbStatKind): Domain {
  if (intervals.length === 0) return kind === "diff" ? { min: -0.1, max: 0.1 } : { min: 0, max: 1 };
  const lo = Math.min(...intervals.map((i) => i.lo));
  const hi = Math.max(...intervals.map((i) => i.hi));
  if (kind === "diff") {
    const m = Math.min(1, Math.max(0.05, Math.max(Math.abs(lo), Math.abs(hi)) * 1.1));
    return { min: -m, max: m };
  }
  const pad = Math.max(kind === "cost" ? 0.01 : 0.02, (hi - lo) * 0.08);
  const max = kind === "percent" ? Math.min(1, hi + pad) : hi + pad;
  return { min: Math.max(0, lo - pad), max };
}

