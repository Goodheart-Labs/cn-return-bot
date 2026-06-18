import type {
  ChartGranularity,
  CnStatus,
  DailyOriginCount,
  NoteRecord,
  NoteSort,
  PipelineRunAggregate,
  PipelineRunDayBucket,
} from "./types";
import { matchesAbFilters, type ABFilters } from "../../../dashboard-shared/abFilters";

export function filterNotes(notes: NoteRecord[], filters: ABFilters): NoteRecord[] {
  const hasFilter = Object.values(filters).some(Boolean);
  return hasFilter ? notes.filter((n) => matchesAbFilters(n.ab_test_picks, filters)) : notes;
}

// ─── Time bucketing ──────────────────────────────────────────────────────────

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function bucketKey(submittedAt: string, granularity: ChartGranularity): string {
  const d = new Date(submittedAt);
  if (granularity === "daily") {
    return d.toISOString().slice(0, 10);
  }
  // Weekly: Monday-anchored ISO week start (UTC).
  const dayOfWeekUtc = d.getUTCDay();
  const daysSinceMonday = (dayOfWeekUtc + 6) % 7;
  const monday = new Date(d.getTime() - daysSinceMonday * ONE_DAY_MS);
  return monday.toISOString().slice(0, 10);
}

// Drop the in-progress week — a partial-week bar that drags the chart down
// until Sunday. No-op for daily granularity. Works on any keyed bucket.
export function dropInProgressWeek<T extends { key: string }>(
  buckets: T[],
  granularity: ChartGranularity,
): T[] {
  if (granularity !== "weekly") return buckets;
  const currentWeekKey = bucketKey(new Date().toISOString(), "weekly");
  return buckets.filter((b) => b.key !== currentWeekKey);
}

export function bucketLabel(key: string, granularity: ChartGranularity): string {
  const d = new Date(`${key}T00:00:00Z`);
  if (granularity === "daily") {
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  return `Wk of ${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })}`;
}

export interface ChartBucket {
  key: string;
  label: string;
  helpful: number;
  unhelpful: number;
  nmr: number;
  /**
   * Pipeline runs in this bucket that didn't end up as a submitted note.
   * Computed by `bucketize` from `runsByDay`; `helpful + unhelpful + nmr`
   * already accounts for all submitted notes that landed in this bucket.
   */
  nonCandidate: number;
  total: number;
}

function getOrCreateBucket(
  byKey: Map<string, ChartBucket>,
  key: string,
  granularity: ChartGranularity,
): ChartBucket {
  let bucket = byKey.get(key);
  if (!bucket) {
    bucket = {
      key,
      label: bucketLabel(key, granularity),
      helpful: 0,
      unhelpful: 0,
      nmr: 0,
      nonCandidate: 0,
      total: 0,
    };
    byKey.set(key, bucket);
  }
  return bucket;
}

/**
 * Bucket submitted notes (always) and — when `runsByDay` is supplied —
 * pipeline runs that didn't produce a submitted note (rejected / filtered /
 * failed / candidate-but-not-yet-submitted). Filters re-apply against
 * `runsByDay` because each row carries its own ab_test_picks.
 */
export function bucketize(
  notes: NoteRecord[],
  granularity: ChartGranularity,
  runsByDay?: PipelineRunDayBucket[],
  filters: ABFilters = {},
): ChartBucket[] {
  const byKey = new Map<string, ChartBucket>();

  for (const n of notes) {
    const key = bucketKey(n.submitted_at, granularity);
    const bucket = getOrCreateBucket(byKey, key, granularity);
    if (n.cn_status === "CURRENTLY_RATED_HELPFUL") bucket.helpful++;
    else if (n.cn_status === "CURRENTLY_RATED_NOT_HELPFUL") bucket.unhelpful++;
    else bucket.nmr++;
    bucket.total++;
  }

  if (runsByDay) {
    for (const day of runsByDay) {
      if (!matchesAbFilters(day.ab_test_picks, filters)) continue;
      const nonCandidate = day.total_count - day.submitted_count;
      if (nonCandidate <= 0) continue;
      const key = bucketKey(`${day.date}T00:00:00Z`, granularity);
      const bucket = getOrCreateBucket(byKey, key, granularity);
      bucket.nonCandidate += nonCandidate;
      bucket.total += nonCandidate;
    }
  }

  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// ─── Origin share (% of all rated-helpful notes) ─────────────────────────────

export interface ShareBucket {
  key: string;
  label: string;
  ours: number;
  otherAi: number;
  human: number;
  total: number;
}

/**
 * Bucket the per-day origin counts (helpful notes split into ours / top other
 * AI / total) into the chart's granularity. Human-written is the remainder:
 * total − ours − otherAi (clamped ≥ 0 against any dump rounding).
 */
export function bucketizeOrigin(
  counts: DailyOriginCount[],
  granularity: ChartGranularity,
): ShareBucket[] {
  const byKey = new Map<string, ShareBucket>();
  for (const c of counts) {
    const key = bucketKey(`${c.day}T00:00:00Z`, granularity);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { key, label: bucketLabel(key, granularity), ours: 0, otherAi: 0, human: 0, total: 0 };
      byKey.set(key, bucket);
    }
    bucket.ours += c.helpful_ours;
    bucket.otherAi += c.helpful_other_ai;
    bucket.total += c.helpful_total;
  }
  for (const bucket of byKey.values()) {
    bucket.human = Math.max(0, bucket.total - bucket.ours - bucket.otherAi);
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// ─── Headline metrics ────────────────────────────────────────────────────────

export interface HeadlineMetrics {
  totalNotes: number;
  helpfulNotes: number;
  unhelpfulNotes: number;
  nmrNotes: number;
  totalViews: number;
  viewsOnHelpful: number;
  totalCost: number | null;            // null when no AB-matching cost data
  costPerHelpfulNote: number | null;
  costPerViewOnHelpful: number | null;
}

export function computeHeadlineMetrics(
  notes: NoteRecord[],
  aggregates: PipelineRunAggregate[],
  filters: ABFilters,
): HeadlineMetrics {
  const filteredNotes = filterNotes(notes, filters);
  const helpfulNotes = filteredNotes.filter((n) => n.cn_status === "CURRENTLY_RATED_HELPFUL");
  const unhelpfulNotes = filteredNotes.filter((n) => n.cn_status === "CURRENTLY_RATED_NOT_HELPFUL");
  const nmrNotes = filteredNotes.filter((n) => n.cn_status !== "CURRENTLY_RATED_HELPFUL" && n.cn_status !== "CURRENTLY_RATED_NOT_HELPFUL");
  const totalViews = filteredNotes.reduce((sum, n) => sum + n.view_count, 0);
  const viewsOnHelpful = helpfulNotes.reduce((sum, n) => sum + n.view_count, 0);

  const matchingAggregates = aggregates.filter((a) => matchesAbFilters(a.ab_test_picks, filters));
  const totalCost = matchingAggregates.reduce((sum, a) => sum + a.total_cost, 0);
  const helpfulInCostEra = helpfulNotes.filter((n) => n.cost != null);

  const costPerHelpfulNote =
    matchingAggregates.length === 0 || helpfulInCostEra.length === 0
      ? null
      : totalCost / helpfulInCostEra.length;
  const viewsOnHelpfulInCostEra = helpfulInCostEra.reduce((sum, n) => sum + n.view_count, 0);
  const costPerViewOnHelpful =
    matchingAggregates.length === 0 || viewsOnHelpfulInCostEra === 0
      ? null
      : totalCost / viewsOnHelpfulInCostEra;

  return {
    totalNotes: filteredNotes.length,
    helpfulNotes: helpfulNotes.length,
    unhelpfulNotes: unhelpfulNotes.length,
    nmrNotes: nmrNotes.length,
    totalViews,
    viewsOnHelpful,
    totalCost: matchingAggregates.length === 0 ? null : totalCost,
    costPerHelpfulNote,
    costPerViewOnHelpful,
  };
}

// ─── Note list sorting ───────────────────────────────────────────────────────

export function sortNotesForList(notes: NoteRecord[], sort: NoteSort): NoteRecord[] {
  if (sort === "latest_helpful") {
    return notes
      .filter((n) => n.cn_status === "CURRENTLY_RATED_HELPFUL")
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  }
  if (sort === "most_views_helpful") {
    return notes
      .filter((n) => n.cn_status === "CURRENTLY_RATED_HELPFUL")
      .sort((a, b) => b.view_count - a.view_count);
  }
  return notes
    .filter((n) => n.cn_status === "CURRENTLY_RATED_NOT_HELPFUL")
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
}

// ─── CN status helpers ───────────────────────────────────────────────────────

export function cnStatusBadge(status: CnStatus): { label: string; className: string } {
  if (status === "CURRENTLY_RATED_HELPFUL")
    return { label: "Helpful", className: "bg-green-100 text-green-800" };
  if (status === "CURRENTLY_RATED_NOT_HELPFUL")
    return { label: "Not helpful", className: "bg-red-100 text-red-800" };
  if (status === "NEEDS_MORE_RATINGS")
    return { label: "Needs more ratings", className: "bg-blue-100 text-blue-800" };
  return { label: "Pending", className: "bg-gray-100 text-gray-600" };
}
