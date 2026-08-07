import { supabase } from "./supabase";
import type {
  ReviewItem,
  ComparisonNote,
  Annotation,
  FailureType,
  FilterState,
  UploadInfo,
  FailureModeInfo,
} from "./types";
import { resultToFailureType, FAILURE_TYPE_CONFIG } from "./types";
import { fetchAllRows, fetchInBatches } from "../../../dashboard-shared/supabasePaging";
import { csvRowToReviewItemInsert } from "../../../dashboard-shared/reviewUpload";
import { topicSetFor, topicIdsForSets } from "../../../dashboard-shared/topicSets";
import type { ABFilters } from "../../../dashboard-shared/abFilters";

// ─── Production data ─────────────────────────────────────────────────────────
//
// The production list is served by Postgres RPCs (migration 073): the
// review_dashboard_items_v view joins and classifies every item server-side,
// review_dashboard_page returns one keyset-paginated screenful of fully-hydrated
// ReviewItems, and review_dashboard_counts returns the pill/tag/burndown/A-B
// aggregates. The client no longer joins tables or classifies notes — it
// compiles its filter lenses into the RPCs' flat filter object and renders.

const ONE_HOUR_MS = 60 * 60 * 1000;
const COMPETITOR_LEAD_THRESHOLDS = [
  { hours: 12, label: "competitor >12h ahead" },
  { hours: 3, label: "competitor >3h ahead" },
  { hours: 1, label: "competitor >1h ahead" },
];

function computeCompetitorLeadTag(
  ourSubmittedAt: string | undefined,
  comparisonNotes: ComparisonNote[],
): string | undefined {
  if (!ourSubmittedAt) return undefined;
  const ourTime = new Date(ourSubmittedAt).getTime();

  const helpfulNotes = comparisonNotes.filter(
    (cn) => cn.status === "CURRENTLY_RATED_HELPFUL" && cn.createdAtMillis != null,
  );
  if (helpfulNotes.length === 0) return undefined;

  const earliestCompetitor = Math.min(...helpfulNotes.map((cn) => cn.createdAtMillis!));
  const leadMs = ourTime - earliestCompetitor;
  if (leadMs <= 0) return undefined; // we were first

  for (const { hours, label } of COMPETITOR_LEAD_THRESHOLDS) {
    if (leadMs > hours * ONE_HOUR_MS) return label;
  }
  return undefined;
}

// ─── Filter compilation ──────────────────────────────────────────────────────

/** Flat filter object the page/counts RPCs take. Every key optional; an absent
 * key means "no restriction". `draftsOn` PRESENT means draft gating is active:
 * drafts are hidden unless their failure type is in the list. */
export interface PageFilters {
  failureTypes?: FailureType[];
  draftsOn?: FailureType[];
  seen?: boolean;
  tags?: string[];
  highValue?: boolean;
  ab?: Record<string, string>;
  topicIds?: string[];
}

/**
 * Compile the filter bar's lens-precedence tree into the RPCs' flat conjunction.
 * The precedence and per-lens semantics mirror the UI's rules exactly:
 * - Topic lens (any topic set selected) is the primary filter: every note in the
 *   set shows regardless of failure type; drafts stay hidden unless their own
 *   pill is on; seen still narrows.
 * - High-value ★ lens: starred items only. Tags (if any) narrow within it and
 *   take precedence over the pills; an empty pill set means "all types" so
 *   clearing pills can't strand an empty list. Drafts are NOT gated (a starred
 *   draft shows).
 * - Tag lens (failure-mode tags selected): tagged items only, regardless of
 *   failure type and SEEN state — tagged items are usually already seen, so
 *   applying those filters would hide the very items you clicked to see.
 * - Default: pills are an allow-list (empty = all types), drafts hidden unless
 *   their own pill is selected, seen narrows.
 * A/B filters apply in every lens.
 */
export function compileFilters(filters: FilterState, abFilters: ABFilters): PageFilters {
  const f: PageFilters = {};

  const ab: Record<string, string> = {};
  for (const [slot, variant] of Object.entries(abFilters)) {
    if (variant) ab[slot] = variant;
  }
  if (Object.keys(ab).length > 0) f.ab = ab;

  const seen = filters.seen === "seen" ? true : filters.seen === "unseen" ? false : undefined;

  if (filters.topicSets.size > 0) {
    f.topicIds = topicIdsForSets(filters.topicSets);
    f.draftsOn = [...filters.failureTypes];
    if (seen !== undefined) f.seen = seen;
    return f;
  }

  if (filters.highValueOnly) {
    f.highValue = true;
    if (filters.failureModes.size > 0) {
      f.tags = [...filters.failureModes];
    } else if (filters.failureTypes.size > 0) {
      f.failureTypes = [...filters.failureTypes];
    }
    if (seen !== undefined) f.seen = seen;
    return f;
  }

  if (filters.failureModes.size > 0) {
    f.tags = [...filters.failureModes];
    return f;
  }

  if (filters.failureTypes.size > 0) f.failureTypes = [...filters.failureTypes];
  f.draftsOn = [...filters.failureTypes];
  if (seen !== undefined) f.seen = seen;
  return f;
}

// ─── Page fetch ──────────────────────────────────────────────────────────────

export interface PageCursor {
  d: string; // sortDate of the last item on the previous page
  id: string;
}

export interface DashboardPage {
  items: ReviewItem[];
  nextCursor: PageCursor | null;
  // Count of ALL items matching the filters — only computed on the first page
  // (cursor null); null on subsequent pages.
  totalItems: number | null;
}

export const PAGE_SIZE = 50;

/** One server-joined, server-filtered, keyset-paginated page of review items. */
export async function fetchDashboardPage(
  filters: PageFilters,
  cursor: PageCursor | null,
  pageSize: number = PAGE_SIZE,
): Promise<DashboardPage> {
  const { data, error } = await supabase.rpc("review_dashboard_page", {
    p_filters: filters,
    p_cursor_date: cursor?.d ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_page_size: pageSize,
  });
  if (error) throw error;
  return {
    items: (data.items as any[]).map(rowToReviewItem),
    nextCursor: data.nextCursor ?? null,
    totalItems: data.totalItems ?? null,
  };
}

/** The RPC emits ReviewItem-shaped JSON; this attaches the two client-derived
 * fields (competitor lead tag, topic set) and normalizes SQL nulls. */
function rowToReviewItem(row: any): ReviewItem {
  const item: ReviewItem = { ...row };
  if (row.annotation === null) delete (item as any).annotation;
  if (row.topic === null) delete (item as any).topic;
  if (row.evaluationScore != null) item.evaluationScore = Number(row.evaluationScore);
  if (item.topic) item.topicSet = topicSetFor(item.topic);
  if (item.failureType === "lost_to_competitor") {
    item.competitorLeadTag = computeCompetitorLeadTag(item.createdAt, item.comparisonNotes ?? []);
  }
  return item;
}

// ─── Counts fetch ────────────────────────────────────────────────────────────

export interface FailureTypeCounts {
  failureType: FailureType;
  total: number; // all-time
  unseen: number; // not marked seen (burndown backlog)
  current: number; // under the seen + A/B filters
  matured30d: number; // items dated 14–44 days ago (burndown inflow proxy)
}

export interface TagCount {
  tag: string;
  total: number;
  current: number; // under the seen + A/B filters
  last30d: number; // on notes dated in the last 30 days (card selector sort)
}

export interface AbVariantCount {
  slot: string;
  variant: string;
  lastPickedAt: string;
}

export interface DashboardCounts {
  byFailureType: FailureTypeCounts[];
  tagCounts: TagCount[];
  // updated_at of every seen production annotation — review pace + "done today".
  seenAnnotationTimes: string[];
  abVariants: AbVariantCount[];
  topicCounts: { topic: string; count: number }[];
}

/** Pill/tag/burndown/A-B aggregates, computed server-side in one pass. Only the
 * `seen` and `ab` filter keys apply (the pills report the whole picture). */
export async function fetchDashboardCounts(filters: PageFilters): Promise<DashboardCounts> {
  const { data, error } = await supabase.rpc("review_dashboard_counts", {
    p_filters: { seen: filters.seen, ab: filters.ab },
  });
  if (error) throw error;
  return data;
}

// ─── Logs (lazy, per opened card) ────────────────────────────────────────────

/**
 * Fetch the full JSONB `logs` for a set of pipeline_run ids. Called by the UI
 * when a card's log panel is opened so we only pay the TOAST cost for rows the
 * user actually sees, not every note we've ever written.
 */
export async function fetchLogsForRuns(runIds: string[]): Promise<Map<string, Record<string, unknown>>> {
  if (runIds.length === 0) return new Map();
  const rows = await fetchInBatches<{ id: string; logs: Record<string, unknown> | null }>(
    supabase,
    "pipeline_runs",
    "id, logs",
    "id",
    runIds,
    undefined,
    "logs",
  );
  const map = new Map<string, Record<string, unknown>>();
  for (const r of rows) if (r.logs) map.set(r.id, r.logs);
  return map;
}

// ─── Dataset run data ────────────────────────────────────────────────────────

export async function fetchUploads(): Promise<UploadInfo[]> {
  const { data, error } = await supabase
    .from("review_dashboard_uploads")
    .select("id, name, item_count, created_at")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((d: any) => ({
    id: d.id,
    name: d.name,
    itemCount: d.item_count,
    createdAt: d.created_at,
  }));
}

export async function fetchDatasetRunItems(uploadId: string): Promise<ReviewItem[]> {
  const data = await fetchAllRows<any>(
    supabase
      .from("review_dashboard_items")
      .select("*")
      .eq("upload_id", uploadId)
      .order("created_at", { ascending: true })
  );

  if (data.length === 0) return [];

  const itemIds = data.map((d: any) => d.id);
  const annotations = await fetchInBatches<any>(
    supabase, "review_dashboard_annotations", "*", "target_id", itemIds,
    (q) => q.eq("source", "dataset_run"), "dataset_run_annotations",
  );

  const annotationMap = new Map<string, Annotation>();
  for (const a of annotations) {
    annotationMap.set(a.target_id, {
      id: a.id,
      seen: a.seen,
      failureModes: a.failure_modes ?? [],
      comment: a.comment,
      highValue: a.high_value ?? false,
    });
  }

  return data.map((row: any) => ({
    id: row.id,
    source: "dataset_run" as const,
    tweetId: row.url?.match(/status\/(\d+)/)?.[1] ?? "",
    tweetText: row.tweet_text,
    noteText: row.note_text,
    createdAt: row.created_at,
    outcome: row.outcome,
    result: row.result,
    needsNote: row.needs_note,
    groundTruthNote: row.ground_truth_note,
    judgeGuidance: row.judge_guidance ?? undefined,
    originalNoteText: row.original_note_text ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    evaluationScore: row.evaluation_score ? Number(row.evaluation_score) : undefined,
    logs: row.logs,
    comparisonNotes: row.ground_truth_note
      ? [{ noteId: "ground_truth", noteText: row.ground_truth_note, status: "Ground Truth" }]
      : [],
    annotation: annotationMap.get(row.id),
    failureType: resultToFailureType(row.result),
  }));
}

export async function fetchDatasetRunCounts(uploadId: string): Promise<Record<FailureType, number>> {
  const counts = Object.fromEntries(
    Object.keys(FAILURE_TYPE_CONFIG).map((k) => [k, 0]),
  ) as Record<FailureType, number>;

  const { data } = await supabase
    .from("review_dashboard_items")
    .select("result")
    .eq("upload_id", uploadId);

  for (const row of data ?? []) {
    const ft = resultToFailureType(row.result);
    counts[ft]++;
  }

  return counts;
}

// ─── Annotations ─────────────────────────────────────────────────────────────

export async function upsertAnnotation(
  source: "production" | "dataset_run",
  targetId: string,
  update: Partial<{ seen: boolean; failureModes: string[]; comment: string; highValue: boolean }>,
): Promise<void> {
  // One atomic upsert keyed on (source, target_id). Only the fields present in
  // `update` are written; the rest fall back to their column defaults on first
  // insert and are left untouched on a conflict-merge. Replaces an older
  // select-then-insert/update dance that could silently throw (e.g. when a
  // duplicate row made `.single()` error, then the fresh insert hit the unique
  // constraint) — which surfaced as a star click that "did nothing".
  const row: Record<string, unknown> = {
    source,
    target_id: targetId,
    updated_at: new Date().toISOString(),
  };
  if (update.seen !== undefined) row.seen = update.seen;
  if (update.failureModes !== undefined) row.failure_modes = update.failureModes;
  if (update.comment !== undefined) row.comment = update.comment;
  if (update.highValue !== undefined) row.high_value = update.highValue;

  const { error } = await supabase
    .from("review_dashboard_annotations")
    .upsert(row, { onConflict: "source,target_id" });
  if (error) throw error;
}

// ─── Failure modes catalog ───────────────────────────────────────────────────

export async function fetchFailureModes(): Promise<FailureModeInfo[]> {
  const { data, error } = await supabase
    .from("review_dashboard_failure_modes")
    .select("name, fixed")
    .order("name");

  if (error) throw error;
  return (data ?? []).map((d: any) => ({ name: d.name, fixed: !!d.fixed }));
}

export async function createFailureMode(name: string): Promise<void> {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return;

  // Re-adding a previously-fixed tag unfixes it: typing the name into the
  // picker is an explicit signal the user wants the tag back in active use.
  const { error } = await supabase
    .from("review_dashboard_failure_modes")
    .upsert({ name: normalized, fixed: false }, { onConflict: "name" });

  if (error) throw error;
}

export async function setFailureModeFixed(name: string, fixed: boolean): Promise<void> {
  const { error } = await supabase
    .from("review_dashboard_failure_modes")
    .update({ fixed })
    .eq("name", name);
  if (error) throw error;
}

/** Delete catalog entries not referenced by any annotation. Returns surviving entries. */
export async function pruneUnusedFailureModes(): Promise<FailureModeInfo[]> {
  const { data: annotations, error: annErr } = await supabase
    .from("review_dashboard_annotations")
    .select("failure_modes");
  if (annErr) throw annErr;

  const used = new Set((annotations ?? []).flatMap((a: any) => a.failure_modes ?? []));

  const { data: catalog, error: catErr } = await supabase
    .from("review_dashboard_failure_modes")
    .select("name, fixed");
  if (catErr) throw catErr;

  const survivors = (catalog ?? []).filter((d: any) => used.has(d.name));
  const unused = (catalog ?? []).map((d: any) => d.name).filter((n: string) => !used.has(n));
  if (unused.length > 0) {
    const { error } = await supabase
      .from("review_dashboard_failure_modes")
      .delete()
      .in("name", unused);
    if (error) throw error;
  }

  return survivors
    .map((d: any) => ({ name: d.name as string, fixed: !!d.fixed }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Upload ──────────────────────────────────────────────────────────────────

export async function uploadDatasetRun(
  name: string,
  rows: Record<string, any>[],
): Promise<string> {
  const { data: upload, error: uploadError } = await supabase
    .from("review_dashboard_uploads")
    .insert({ name, item_count: rows.length })
    .select("id")
    .single();

  if (uploadError) throw uploadError;

  // Batch insert items in chunks of 50
  const CHUNK = 50;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => csvRowToReviewItemInsert(upload.id, r));

    const { error } = await supabase.from("review_dashboard_items").insert(chunk);
    if (error) throw error;
  }

  return upload.id;
}

export async function deleteUpload(id: string): Promise<void> {
  const { error } = await supabase
    .from("review_dashboard_uploads")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// ============================================================================
// Posting limit (X writing cap) — data for the "Posting limit" drawer.
// The cap is observation-based (X returns a "daily limit" 403 and we record the
// count). This reconstructs X's published AI-writer FORMULA from live note
// statuses so we can see WHICH input the cap is resting on. Formula: X guide
// "writing-notes" + AI-writer page; denominator includes unrated (NMR) notes —
// confirmed by communitynotes/scoring/.../contributor_state.py.
// ============================================================================

const H_STATUS = "CURRENTLY_RATED_HELPFUL";
const NH_STATUS = "CURRENTLY_RATED_NOT_HELPFUL";

export interface CapWindow {
  key: string; // HR_R | HR_100 | HR_14d
  label: string;
  rate: number; // net hit rate = (H − NH) / denom, as a fraction
  h: number;
  nh: number;
  nmr: number; // unrated in-window (0 for the rated-only window)
  denom: number;
  binding: boolean; // is this the window currently setting WL_L?
}

export interface CapTier {
  label: string;
  formula: string;
  active: boolean;
}

export interface PostingLimitData {
  cap: number | null; // observed writing_limit (pipeline_state) — the real ceiling
  limitHitAt: string | null;
  modeledCap: number; // WL from the live formula inputs
  wlL: number; // WL_L quality ceiling
  dn30: number;
  volTerm: number; // DN_30 × 5
  bindingTerm: "quality" | "volume" | "cliff";
  hrL: number; // max(HR_100, HR_14d)
  windows: CapWindow[];
  tiers: CapTier[];
  nh5: number;
  nh10: number;
  bindingWindow: CapWindow | null;
  slopePerPoint: number; // Δcap per +1 percentage-point of the binding window
  ratedAtAll: number; // fraction of ALL notes ever rated (coverage)
  totalNotes: number;
}

function computeWL(i: {
  hr100: number; hr14d: number; hrR: number; dn30: number; nh5: number; nh10: number; t: number;
}): { wl: number; wlL: number; binding: "quality" | "volume" | "cliff" } {
  if (i.nh10 >= 8) return { wl: 2, wlL: 0, binding: "cliff" };
  if (i.nh5 >= 3) return { wl: 5, wlL: 0, binding: "cliff" };
  if (i.t < 20) return { wl: 10, wlL: 0, binding: "quality" };
  const hrL = Math.max(i.hr100, i.hr14d);
  let wlL: number;
  if (hrL < 0.05) wlL = 300 * Math.max(i.hrR, hrL);
  else if (hrL < 0.1) wlL = 15 + 700 * (hrL - 0.05);
  else if (hrL < 0.15) wlL = 50 + 3000 * (hrL - 0.1);
  else if (hrL < 0.2) wlL = 200 + 6000 * (hrL - 0.15);
  else wlL = 500;
  const vol = i.dn30 * 5;
  const wl = Math.max(5, Math.floor(Math.min(vol, wlL)));
  return { wl, wlL, binding: vol < wlL ? "volume" : "quality" };
}

export async function fetchPostingLimitData(): Promise<PostingLimitData> {
  const [{ data: capRow }, { data: hitRow }, { data: noteRows, error: notesErr }] = await Promise.all([
    supabase.from("pipeline_state").select("value").eq("key", "writing_limit").maybeSingle(),
    supabase.from("pipeline_state").select("value").eq("key", "limit_hit_at").maybeSingle(),
    // Every note's status + submitted_at in one RPC response (a table select
    // would be capped at 1000 rows).
    supabase.rpc("review_dashboard_posting_notes"),
  ]);
  if (notesErr) throw notesErr;
  const cap = capRow?.value != null ? Number(capRow.value) : null;
  const limitHitAt = (hitRow?.value as string) ?? null;

  const notes = (noteRows as { cn_status: string | null; submitted_at: string | null }[])
    .filter((n) => n.submitted_at)
    .sort((a, b) => (a.submitted_at! < b.submitted_at! ? -1 : 1));

  const now = Date.now();
  const DAY = 86400000;
  const isH = (s: string | null) => s === H_STATUS;
  const isNH = (s: string | null) => s === NH_STATUS;
  const count = (arr: typeof notes) => ({
    h: arr.filter((n) => isH(n.cn_status)).length,
    nh: arr.filter((n) => isNH(n.cn_status)).length,
  });

  const last20 = notes.slice(-20);
  const last100 = notes.slice(-100);
  const in14 = notes.filter((n) => now - Date.parse(n.submitted_at!) < 14 * DAY);
  const rated14 = in14.filter((n) => isH(n.cn_status) || isNH(n.cn_status));
  const in30 = notes.filter((n) => now - Date.parse(n.submitted_at!) < 30 * DAY);

  const c20 = count(last20), c100 = count(last100), c14 = count(rated14);
  const hrR = (c20.h - c20.nh) / 20;
  const hr100 = (c100.h - c100.nh) / 100;
  // Denominator = ALL notes written in the window, not just rated ones. X's own
  // scoring counts NMR notes in totalNotes, and the all-written variant is the
  // only one that has reproduced X's observed cap (rated-only inflated the rate
  // ~6x — Nathan, 2026-08-05: "laughably wrong").
  const hr14d = in14.length ? (c14.h - c14.nh) / in14.length : 0;
  const dn30 = in30.length / 30;

  const ratedRev = notes.filter((n) => isH(n.cn_status) || isNH(n.cn_status)).reverse();
  const nh5 = ratedRev.slice(0, 5).filter((n) => isNH(n.cn_status)).length;
  const nh10 = ratedRev.slice(0, 10).filter((n) => isNH(n.cn_status)).length;

  const t = notes.length;
  const cur = computeWL({ hr100, hr14d, hrR, dn30, nh5, nh10, t });
  const hrL = Math.max(hr100, hr14d);

  // Which window is carrying WL_L: below 5% the last-20 also counts (formula takes the max).
  const basement = hrL < 0.05;
  const pool: [string, number][] = basement
    ? [["HR_R", hrR], ["HR_100", hr100], ["HR_14d", hr14d]]
    : [["HR_100", hr100], ["HR_14d", hr14d]];
  let bindKey = "HR_100";
  let best = -Infinity;
  for (const [k, v] of pool) if (v > best) { best = v; bindKey = k; }
  const qualityBound = cur.binding === "quality";

  const windows: CapWindow[] = [
    { key: "HR_R", label: "Last 20 written", rate: hrR, h: c20.h, nh: c20.nh, nmr: 20 - c20.h - c20.nh, denom: 20, binding: qualityBound && bindKey === "HR_R" },
    { key: "HR_100", label: "Last 100 written", rate: hr100, h: c100.h, nh: c100.nh, nmr: 100 - c100.h - c100.nh, denom: 100, binding: qualityBound && bindKey === "HR_100" },
    { key: "HR_14d", label: "Last 14 days (written)", rate: hr14d, h: c14.h, nh: c14.nh, nmr: in14.length - rated14.length, denom: in14.length, binding: qualityBound && bindKey === "HR_14d" },
  ];

  const tierIdx = hrL < 0.05 ? 0 : hrL < 0.1 ? 1 : hrL < 0.15 ? 2 : hrL < 0.2 ? 3 : 4;
  const tiers: CapTier[] = [
    { label: "< 5%", formula: "WL_L = 300 × max(HR_R, HR_L)", active: tierIdx === 0 },
    { label: "5–10%", formula: "WL_L = 15 + 700 × (HR_L − 5%)", active: tierIdx === 1 },
    { label: "10–15%", formula: "WL_L = 50 + 3000 × (HR_L − 10%)", active: tierIdx === 2 },
    { label: "15–20%", formula: "WL_L = 200 + 6000 × (HR_L − 15%)", active: tierIdx === 3 },
    { label: "≥ 20%", formula: "WL_L = 500 (max)", active: tierIdx === 4 },
  ];

  const bump = { hr100, hr14d, hrR, dn30, nh5, nh10, t };
  if (bindKey === "HR_100") bump.hr100 += 0.01;
  else if (bindKey === "HR_14d") bump.hr14d += 0.01;
  else bump.hrR += 0.01;
  const slopePerPoint = computeWL(bump).wl - cur.wl;

  const ratedTotal = notes.filter((n) => isH(n.cn_status) || isNH(n.cn_status)).length;

  return {
    cap, limitHitAt, modeledCap: cur.wl, wlL: cur.wlL, dn30, volTerm: dn30 * 5,
    bindingTerm: cur.binding, hrL, windows, tiers, nh5, nh10,
    bindingWindow: windows.find((w) => w.binding) ?? null,
    slopePerPoint, ratedAtAll: t ? ratedTotal / t : 0, totalNotes: t,
  };
}
