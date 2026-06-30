// A/B comparison panel: project pipeline data onto a chosen set of A/B tests
// ("dimensions"), group into variant-combinations, and map each to a metric
// interval. Mirrors the grouping style of aggregations.ts.
//
// Source-of-truth split (the one trap): note records drive helpful/unhelpful/
// nmr counts; run-outcome aggregates drive total/candidate counts. They are
// counted in separate passes and never mixed for the same numerator — a
// submitted run can lack a submitted_at note row (and vice-versa), so the two
// denominators can differ slightly.

import type { AbOutcomeAggregate, NoteRecord } from "./types";
import { matchesAbFilters, type ABFilters } from "../../../dashboard-shared/abFilters";
import { costPerCountCI, proportionCI, proportionDiffCI, type Interval } from "./confidenceIntervals";

export type AbComparisonStat =
  | "pct_helpful"
  | "pct_unhelpful"
  | "pct_helpful_minus_unhelpful"
  | "pct_candidate"
  | "cost_per_helpful";

// How a stat's values read on the axis: a 0–100% proportion, a signed
// difference around 0, or a currency ratio.
export type AbStatKind = "percent" | "diff" | "cost";

export interface AbComboCounts {
  helpful: number;
  unhelpful: number;
  nmr: number;
  candidate: number; // from run aggregates
  total: number; // terminal runs, from run aggregates
  cost: number; // summed cost over terminal runs, from run aggregates
}

export interface AbCombo {
  key: string; // canonical, dim-ordered → stable hide-set key
  picks: Record<string, string>; // subset of picks for the selected dimensions
  label: string; // e.g. "search=grok43-native · prompts=detailed"
  counts: AbComboCounts;
}

/**
 * Project a full picks dict onto the selected dimensions. Returns null if any
 * selected dimension is missing — such records are excluded from the split
 * (you can't compare a test on runs that never set it).
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
  return { helpful: 0, unhelpful: 0, nmr: 0, candidate: 0, total: 0, cost: 0 };
}

/**
 * Group notes and run aggregates into variant-combinations of the selected
 * dimensions, after applying the top-level A/B filters. Returns one AbCombo per
 * observed combination, sorted by label for stability across stat switches.
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

  // Notes pass — helpful / unhelpful / nmr (same branch logic as bucketize).
  for (const note of notes) {
    if (sinceDate && note.submitted_at.slice(0, 10) < sinceDate) continue;
    if (!matchesAbFilters(note.ab_test_picks, filters)) continue;
    const projected = projectPicks(note.ab_test_picks, dims);
    if (!projected) continue;
    const counts = getOrCreate(projected).counts;
    if (note.cn_status === "CURRENTLY_RATED_HELPFUL") counts.helpful++;
    else if (note.cn_status === "CURRENTLY_RATED_NOT_HELPFUL") counts.unhelpful++;
    else counts.nmr++;
  }

  // Run-aggregates pass — candidate / total denominators.
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
 * Map a combination's counts + chosen stat to an interval and its sample size.
 * Returns null when n === 0 (caller renders a "no data" row).
 *
 * Denominator: submitted notes by default, all terminal runs when
 * includeNonCandidate is set. pct_candidate always uses all runs;
 * cost_per_helpful always uses all-run cost over the helpful-note count.
 * `n` is the sample size driving the interval (helpful count for cost).
 */
export function statInterval(
  counts: AbComboCounts,
  stat: AbComparisonStat,
  includeNonCandidate: boolean,
  z: number,
): { interval: Interval; n: number } | null {
  const nSubmitted = counts.helpful + counts.unhelpful + counts.nmr;
  const nAll = counts.total;

  if (stat === "pct_candidate") {
    if (nAll === 0) return null;
    return { interval: proportionCI(counts.candidate, nAll, z), n: nAll };
  }

  if (stat === "cost_per_helpful") {
    if (counts.helpful === 0 || counts.cost <= 0) return null;
    return { interval: costPerCountCI(counts.cost, counts.helpful, z), n: counts.helpful };
  }

  const n = includeNonCandidate ? nAll : nSubmitted;
  if (n === 0) return null;
  if (stat === "pct_helpful") return { interval: proportionCI(counts.helpful, n, z), n };
  if (stat === "pct_unhelpful") return { interval: proportionCI(counts.unhelpful, n, z), n };
  // pct_helpful_minus_unhelpful
  return { interval: proportionDiffCI(counts.helpful, counts.unhelpful, n, z), n };
}

export function statKind(stat: AbComparisonStat): AbStatKind {
  if (stat === "pct_helpful_minus_unhelpful") return "diff";
  if (stat === "cost_per_helpful") return "cost";
  return "percent";
}

// These stats inherently span all runs, so the "include non-candidate runs"
// toggle is forced on and disabled for them.
export function forcesAllRuns(stat: AbComparisonStat): boolean {
  return stat === "pct_candidate" || stat === "cost_per_helpful";
}

// Cost is better when lower; the proportion stats are better when higher. Used
// only to order rows (best on top).
export function lowerIsBetter(stat: AbComparisonStat): boolean {
  return stat === "cost_per_helpful";
}

export const STAT_LABELS: Record<AbComparisonStat, string> = {
  pct_helpful: "Percent Helpful",
  pct_unhelpful: "Percent Unhelpful",
  pct_helpful_minus_unhelpful: "Percent Helpful − Unhelpful",
  pct_candidate: "Percent of Candidate Runs out of all runs",
  cost_per_helpful: "Cost per Helpful Note",
};

// "Last N days" window options for the comparison panel; null = all time.
export const WINDOW_DAY_OPTIONS: (number | null)[] = [null, 7, 14, 30, 90];

export function windowLabel(days: number | null): string {
  return days === null ? "All time" : `Last ${days} days`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Inclusive UTC start date (YYYY-MM-DD) for a "last N days" window: rows whose
// date is on or after this are kept. null window → null (keep everything).
export function windowStartDate(days: number | null): string | null {
  if (days === null) return null;
  return new Date(Date.now() - days * MS_PER_DAY).toISOString().slice(0, 10);
}
