import type {
  ABFilters,
  ChartGranularity,
  CnStatus,
  NoteRecord,
  NoteSort,
  PipelineRunAggregate,
} from "./types";

// ─── A/B-pick filter ─────────────────────────────────────────────────────────

export function noteMatchesAbFilters(note: NoteRecord, filters: ABFilters): boolean {
  for (const [slot, variant] of Object.entries(filters)) {
    if (!variant) continue;
    if (note.ab_test_picks?.[slot] !== variant) return false;
  }
  return true;
}

export function aggMatchesAbFilters(agg: PipelineRunAggregate, filters: ABFilters): boolean {
  for (const [slot, variant] of Object.entries(filters)) {
    if (!variant) continue;
    if (agg.ab_test_picks?.[slot] !== variant) return false;
  }
  return true;
}

export function filterNotes(notes: NoteRecord[], filters: ABFilters): NoteRecord[] {
  const hasFilter = Object.values(filters).some(Boolean);
  return hasFilter ? notes.filter((n) => noteMatchesAbFilters(n, filters)) : notes;
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
  total: number;
}

export function bucketize(notes: NoteRecord[], granularity: ChartGranularity): ChartBucket[] {
  const byKey = new Map<string, ChartBucket>();
  for (const n of notes) {
    const key = bucketKey(n.submitted_at, granularity);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = {
        key,
        label: bucketLabel(key, granularity),
        helpful: 0,
        unhelpful: 0,
        nmr: 0,
        total: 0,
      };
      byKey.set(key, bucket);
    }
    if (n.cn_status === "CURRENTLY_RATED_HELPFUL") bucket.helpful++;
    else if (n.cn_status === "CURRENTLY_RATED_NOT_HELPFUL") bucket.unhelpful++;
    else bucket.nmr++;
    bucket.total++;
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

  const matchingAggregates = aggregates.filter((a) => aggMatchesAbFilters(a, filters));
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
  const sorted = [...notes];
  if (sort === "latest_helpful") {
    return sorted
      .filter((n) => n.cn_status === "CURRENTLY_RATED_HELPFUL")
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  }
  if (sort === "most_views_helpful") {
    return sorted
      .filter((n) => n.cn_status === "CURRENTLY_RATED_HELPFUL")
      .sort((a, b) => b.view_count - a.view_count);
  }
  return sorted
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
