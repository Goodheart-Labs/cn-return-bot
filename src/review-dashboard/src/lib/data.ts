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
// The production list comes from the Postgres functions added in migration 073.
// The review_dashboard_items_v view joins and classifies every item in the
// database. The review_dashboard_page function returns one page of finished
// ReviewItems, paged with a keyset cursor. The review_dashboard_counts function
// returns the aggregates behind the pills, the tags, the burndown bar and the A/B
// panel. The client no longer joins tables and no longer classifies notes. It
// turns the filter bar's settings into the flat filter object those functions
// take, and renders what comes back.

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
  if (leadMs <= 0) return undefined; // We submitted first.

  for (const { hours, label } of COMPETITOR_LEAD_THRESHOLDS) {
    if (leadMs > hours * ONE_HOUR_MS) return label;
  }
  return undefined;
}

// ─── Filter compilation ──────────────────────────────────────────────────────

/** The flat filter object the page and counts functions take. Every key is
 * optional, and a key that is absent restricts nothing. When the `draftsOn` key
 * is present, draft gating is switched on. Drafts are then hidden unless their
 * failure type appears in that list. */
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
 * Turns the filter bar's settings into the single flat filter the page and counts
 * functions take. The filter bar has four modes, and the first one that applies
 * wins. The rules below are the ones the interface promises.
 *
 * When at least one topic set is selected, the topic filter takes over. Every
 * note on those topics shows, whatever its failure type. Drafts stay hidden
 * unless their own pill is switched on. The seen filter still narrows the list.
 *
 * When the high-value star is on, only starred items show. Selected tags narrow
 * the list within that set, and they take precedence over the pills. An empty
 * pill selection means every failure type, so clearing the pills can never leave
 * you with an empty list. Drafts are not gated here, so a starred draft shows.
 *
 * When failure-mode tags are selected, only tagged items show. Failure type and
 * seen state are ignored. Tagged items have usually been seen already, so
 * applying those two filters would hide the very items you clicked to look at.
 *
 * Otherwise the pills act as an allow-list, and selecting none of them means
 * every failure type. Drafts are hidden unless their own pill is selected, and
 * the seen filter narrows the list.
 *
 * The A/B filters apply in all four modes.
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
  d: string; // The sortDate of the last item on the previous page.
  id: string;
}

export interface DashboardPage {
  items: ReviewItem[];
  nextCursor: PageCursor | null;
  // How many items match the filters in total. The server only counts them while
  // serving the first page, so this is null on every later page.
  totalItems: number | null;
}

export const PAGE_SIZE = 50;

/** Fetches one page of review items. The server joins, filters and pages them. */
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

/** The database function already returns ReviewItem-shaped JSON. This turns the
 * SQL nulls into absent fields, and adds the two fields the client works out for
 * itself. Those are the competitor lead tag and the topic set. */
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
  total: number; // The count over all time.
  unseen: number; // Items not marked seen. This is the burndown backlog.
  current: number; // The count under the seen and A/B filters.
  matured30d: number; // Items dated 14 to 44 days ago. This estimates the burndown inflow.
}

export interface TagCount {
  tag: string;
  total: number;
  current: number; // The count under the seen and A/B filters.
  last30d: number; // Tags on notes dated in the last 30 days. This orders the card's tag selector.
}

export interface AbVariantCount {
  slot: string;
  variant: string;
  lastPickedAt: string;
}

export interface DashboardCounts {
  byFailureType: FailureTypeCounts[];
  tagCounts: TagCount[];
  // The updated_at of every seen production annotation. The client works out the
  // review pace and how much was done today from these timestamps.
  seenAnnotationTimes: string[];
  abVariants: AbVariantCount[];
  topicCounts: { topic: string; count: number }[];
}

/** Fetches the aggregates behind the pills, the tags, the burndown bar and the
 * A/B panel. The server computes all of them in one pass. Only the `seen` and
 * `ab` filter keys apply here, because the pills are meant to report the whole
 * picture rather than the current pill selection. */
export async function fetchDashboardCounts(filters: PageFilters): Promise<DashboardCounts> {
  const { data, error } = await supabase.rpc("review_dashboard_counts", {
    p_filters: { seen: filters.seen, ab: filters.ab },
  });
  if (error) throw error;
  return data;
}

// ─── Logs (lazy, per opened card) ────────────────────────────────────────────

/**
 * Fetches the full `logs` column for a set of pipeline_run ids. The interface
 * calls this when a reviewer opens a card's log panel. Reading that column is
 * expensive, because Postgres stores such large values out of line. So we only
 * read it for the rows a reviewer actually looks at, rather than for every note
 * we have ever written.
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
  // This is one atomic upsert keyed on the pair (source, target_id). Only the
  // fields present in `update` are written. On a first insert the other columns
  // take their defaults, and on a conflict they are left as they are. An earlier
  // version read the row first and then either inserted or updated it. That could
  // fail silently. A duplicate row made the read throw, and the insert that
  // followed hit the unique constraint. The reviewer saw a star click that did
  // nothing at all.
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

  // Adding a tag that was marked fixed marks it unfixed again. Typing the name
  // into the picker says clearly that the reviewer wants the tag back in use.
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
// The posting limit is the cap X puts on how many notes we may write. This
// section builds the data for the "Posting limit" drawer.
// We only learn our real cap by observation. X answers with a 403 saying the
// daily limit is reached, and we record the count we were at. The code below
// rebuilds X's published formula for AI writers out of our live note statuses,
// so we can see which input is holding the cap down. The formula comes from X's
// "writing-notes" guide and its AI-writer page. Its denominator also counts
// notes that are still unrated, which we confirmed in contributor_state.py in
// X's public communitynotes scoring code.
// ============================================================================

const H_STATUS = "CURRENTLY_RATED_HELPFUL";
const NH_STATUS = "CURRENTLY_RATED_NOT_HELPFUL";

export interface CapWindow {
  key: string; // One of "HR_R", "HR_100" and "HR_14d".
  label: string;
  rate: number; // The net hit rate as a fraction. It is (h − nh) / denom.
  h: number;
  nh: number;
  nmr: number; // How many notes in the window are still unrated.
  denom: number;
  binding: boolean; // True when this is the window currently setting WL_L.
}

export interface CapTier {
  label: string;
  formula: string;
  active: boolean;
}

export interface PostingLimitData {
  cap: number | null; // The real ceiling. We observe it and store it as writing_limit in pipeline_state.
  limitHitAt: string | null;
  modeledCap: number; // The WL the formula gives for the current inputs.
  wlL: number; // The quality ceiling, WL_L.
  dn30: number;
  volTerm: number; // The volume term. It is dn30 times five.
  bindingTerm: "quality" | "volume" | "cliff";
  hrL: number; // The larger of hr100 and hr14d.
  windows: CapWindow[];
  tiers: CapTier[];
  nh5: number;
  nh10: number;
  bindingWindow: CapWindow | null;
  slopePerPoint: number; // How far the cap moves if the binding window gains one percentage point.
  ratedAtAll: number; // The share of all the notes we ever wrote that carry a rating.
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
    // This returns every note's status and submitted_at in one response. A plain
    // select on the table would stop at 1000 rows.
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
  // The denominator is every note written in the window, not only the rated ones.
  // X's own scoring counts notes that still need more ratings in its totals.
  // Counting all written notes is also the only version that has reproduced the
  // cap we actually observe. Counting only the rated notes inflated the rate about
  // six times over, which Nathan called laughably wrong on 2026-08-05.
  const hr14d = in14.length ? (c14.h - c14.nh) / in14.length : 0;
  const dn30 = in30.length / 30;

  const ratedRev = notes.filter((n) => isH(n.cn_status) || isNH(n.cn_status)).reverse();
  const nh5 = ratedRev.slice(0, 5).filter((n) => isNH(n.cn_status)).length;
  const nh10 = ratedRev.slice(0, 10).filter((n) => isNH(n.cn_status)).length;

  const t = notes.length;
  const cur = computeWL({ hr100, hr14d, hrR, dn30, nh5, nh10, t });
  const hrL = Math.max(hr100, hr14d);

  // Work out which window is carrying WL_L. Below 5 percent the last-20 window
  // counts as well, because the formula there takes the largest of the rates.
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
