import { supabase } from "./supabase";
import type {
  ReviewItem,
  ComparisonNote,
  Annotation,
  FailureType,
  UploadInfo,
} from "./types";
import { resultToFailureType } from "./types";

// ─── Production data ─────────────────────────────────────────────────────────

function cnStatusToFailureType(
  cnStatus: string | null,
  hasHelpfulCompetitor: boolean,
): FailureType {
  if (cnStatus === "CURRENTLY_RATED_HELPFUL") return "rated_helpful";
  if (cnStatus === "CURRENTLY_RATED_NOT_HELPFUL") return "rated_unhelpful";
  if (hasHelpfulCompetitor) return "lost_to_competitor";
  if (cnStatus === "NEEDS_MORE_RATINGS") return "needs_more_ratings";
  return "uncategorized";
}

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

async function fetchAllRows<T>(query: any, label?: string): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await query.range(offset, offset + PAGE - 1);
    if (error) {
      console.error(`[data] fetchAllRows failed${label ? ` (${label})` : ""}:`, error);
      throw error;
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  if (label) console.log(`[data] ${label}: ${all.length} rows`);
  return all;
}

// Supabase .in() generates a URL query param — too many IDs makes the URL too long.
// Batch into chunks of 200.
async function fetchInBatches<T>(
  table: string,
  select: string,
  filterCol: string,
  ids: string[],
  extraFilters?: (q: any) => any,
  label?: string,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const CHUNK = 200;
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    let q = supabase.from(table).select(select).in(filterCol, batch);
    if (extraFilters) q = extraFilters(q);
    const { data, error } = await q;
    if (error) {
      console.error(`[data] fetchInBatches failed${label ? ` (${label})` : ""}:`, error);
      throw error;
    }
    if (data) results.push(...(data as T[]));
  }
  if (label) console.log(`[data] ${label}: ${results.length} rows`);
  return results;
}

// Columns needed to render the production list. Dropping select("*") skips
// unused columns (classification timestamps, top_*_tag, etc.) and reduces per-row I/O.
const CANONICAL_LIST_COLUMNS = [
  "note_id",
  "tweet_id",
  "tweet_text",
  "tweet_handle",
  "note_text",
  "source_url",
  "submitted_at",
  "created_at",
  "cn_status",
  "current_core_status",
  "view_count",
  "rating_count",
  "helpful_count",
  "not_helpful_count",
].join(", ");

// pipeline_runs without the logs TOAST column — used for the metadata fetch
// that drives the list. Logs are lazy-loaded per visible card.
const PIPELINE_METADATA_COLUMNS =
  "id, tweet_id, tweet_text, outcome, outcome_reason, bot_id, has_photo, has_video, media_count, created_at";

/**
 * Fetch all the metadata the production dashboard needs in one shot, without
 * any TOASTed blobs. Returns the raw rows; caller composes them into ReviewItems.
 *
 * - canonical: our notes.
 * - competing: all competing_notes (both the "on our tweets" kind and the
 *   "missed opportunity" kind where our_note_id IS NULL).
 * - submittedRuns: pipeline_runs with outcome='submitted' (matched to canonical by tweet_id).
 * - missedRuns: the specific pipeline_runs referenced by missed-opportunity competing
 *   notes (pipeline_run_id IS NOT NULL, current_status='CRH').
 * - annotations: review_dashboard_annotations for our note_ids.
 *
 * This replaces the previous paginated approach — fetching all metadata up
 * front is cheap because we exclude logs; logs are the only expensive column
 * and they're pulled on demand by `fetchLogsForRuns`.
 */
export async function fetchDashboardData(): Promise<{
  canonical: any[];
  competing: any[];
  submittedRuns: any[];
  missedRuns: any[];
  annotations: any[];
}> {
  console.log("[data] Loading dashboard metadata...");
  const [canonical, competing, submittedRuns] = await Promise.all([
    fetchAllRows<any>(
      supabase
        .from("canonical_note_information")
        .select(CANONICAL_LIST_COLUMNS)
        .order("submitted_at", { ascending: false, nullsFirst: false }),
      "canonical",
    ),
    fetchAllRows<any>(supabase.from("competing_notes").select("*"), "competing"),
    fetchAllRows<any>(
      supabase.from("pipeline_runs").select(PIPELINE_METADATA_COLUMNS).eq("outcome", "submitted"),
      "submitted_runs",
    ),
  ]);

  // Missed opportunities reference specific pipeline_run ids; fetch just those
  // (avoids pulling the full rejected-runs table, which is ~20k rows).
  const missedRunIds = [
    ...new Set(
      competing
        .filter(
          (cn: any) =>
            cn.our_note_id === null &&
            cn.current_status === "CURRENTLY_RATED_HELPFUL" &&
            cn.pipeline_run_id,
        )
        .map((cn: any) => cn.pipeline_run_id as string),
    ),
  ];
  const missedRuns = missedRunIds.length
    ? await fetchInBatches<any>(
        "pipeline_runs",
        PIPELINE_METADATA_COLUMNS,
        "id",
        missedRunIds,
        undefined,
        "missed_runs",
      )
    : [];

  const noteIds = canonical.map((n: any) => n.note_id);
  const annotations = await fetchInBatches<any>(
    "review_dashboard_annotations",
    "*",
    "target_id",
    noteIds,
    (q) => q.eq("source", "production"),
    "annotations",
  ).catch(() => [] as any[]);

  return { canonical, competing, submittedRuns, missedRuns, annotations };
}

/**
 * Fetch the full JSONB `logs` for a set of pipeline_run ids. Called by the UI
 * when a card becomes visible so we only pay the TOAST cost for rows the user
 * actually sees, not every note we've ever written.
 */
export async function fetchLogsForRuns(runIds: string[]): Promise<Map<string, Record<string, unknown>>> {
  if (runIds.length === 0) return new Map();
  const rows = await fetchInBatches<{ id: string; logs: Record<string, unknown> | null }>(
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

/**
 * Compose ReviewItems from the raw metadata fetched by fetchDashboardData.
 * Pure function; no I/O. Items have a `pipelineRunId` instead of `logs`;
 * `logs` is filled in later by the caller using fetchLogsForRuns.
 */
export function buildDashboardItems(data: {
  canonical: any[];
  competing: any[];
  submittedRuns: any[];
  missedRuns: any[];
  annotations: any[];
}): ReviewItem[] {
  const { canonical, competing, submittedRuns, missedRuns, annotations } = data;

  const pipelineByTweet = new Map<string, any>();
  for (const pr of submittedRuns) pipelineByTweet.set(pr.tweet_id, pr);

  const pipelineById = new Map<string, any>();
  for (const pr of missedRuns) pipelineById.set(pr.id, pr);

  const competingByOurNote = new Map<string, ComparisonNote[]>();
  const helpfulCompetitorNoteIds = new Set<string>();
  for (const cn of competing) {
    if (cn.our_note_id == null) continue;
    if (!competingByOurNote.has(cn.our_note_id)) competingByOurNote.set(cn.our_note_id, []);
    competingByOurNote.get(cn.our_note_id)!.push({
      noteId: cn.note_id,
      noteText: cn.note_text,
      status: cn.current_status,
      coreStatus: cn.current_core_status,
      helpfulCount: cn.helpful_count,
      notHelpfulCount: cn.not_helpful_count,
      authorId: cn.author_participant_id,
      createdAtMillis: cn.created_at_millis,
    });
    if (cn.current_status === "CURRENTLY_RATED_HELPFUL") helpfulCompetitorNoteIds.add(cn.our_note_id);
  }

  const annotationByTarget = new Map<string, Annotation>();
  for (const a of annotations) {
    annotationByTarget.set(a.target_id, {
      id: a.id,
      seen: a.seen,
      failureModes: a.failure_modes ?? [],
      comment: a.comment,
    });
  }

  const items: ReviewItem[] = [];

  for (const note of canonical) {
    const pipeline = pipelineByTweet.get(note.tweet_id);
    const hasHelpfulCompetitor = helpfulCompetitorNoteIds.has(note.note_id);
    const compNotes = competingByOurNote.get(note.note_id) ?? [];
    const failureType = cnStatusToFailureType(note.cn_status, hasHelpfulCompetitor);
    items.push({
      id: note.note_id,
      source: "production" as const,
      tweetId: note.tweet_id,
      tweetText: note.tweet_text ?? pipeline?.tweet_text,
      tweetHandle: note.tweet_handle,
      hasPhoto: pipeline?.has_photo ?? false,
      hasVideo: pipeline?.has_video ?? false,
      mediaCount: pipeline?.media_count ?? 0,
      noteId: note.note_id,
      noteText: note.note_text,
      sourceUrl: note.source_url,
      createdAt: note.submitted_at ?? note.created_at,
      status: note.cn_status,
      coreStatus: note.current_core_status,
      viewCount: note.view_count,
      ratingCount: note.rating_count,
      helpfulCount: note.helpful_count,
      notHelpfulCount: note.not_helpful_count,
      outcome: pipeline?.outcome,
      outcomeReason: pipeline?.outcome_reason,
      pipelineRunId: pipeline?.id,
      botId: pipeline?.bot_id,
      comparisonNotes: compNotes,
      annotation: annotationByTarget.get(note.note_id),
      competitorLeadTag: failureType === "lost_to_competitor"
        ? computeCompetitorLeadTag(note.submitted_at ?? note.created_at, compNotes)
        : undefined,
      failureType,
    });
  }

  for (const cn of competing) {
    if (cn.our_note_id != null) continue;
    if (cn.current_status !== "CURRENTLY_RATED_HELPFUL") continue;
    if (!cn.pipeline_run_id) continue;
    const pr = pipelineById.get(cn.pipeline_run_id);
    if (!pr) continue;
    items.push({
      id: `missed:${cn.note_id}`,
      source: "production" as const,
      tweetId: cn.tweet_id,
      tweetText: pr.tweet_text,
      noteText: undefined,
      createdAt: pr.created_at,
      outcome: pr.outcome,
      outcomeReason: pr.outcome_reason,
      pipelineRunId: pr.id,
      comparisonNotes: [
        {
          noteId: cn.note_id,
          noteText: cn.note_text,
          status: cn.current_status,
          coreStatus: cn.current_core_status,
          helpfulCount: cn.helpful_count,
          notHelpfulCount: cn.not_helpful_count,
          authorId: cn.author_participant_id,
        },
      ],
      failureType: "missed_opportunity" as const,
    });
  }

  return items;
}

// ─── Production counts ───────────────────────────────────────────────────────

export function countsFromItems(items: ReviewItem[]): Record<FailureType, number> {
  const counts: Record<FailureType, number> = {
    rated_helpful: 0,
    rated_unhelpful: 0,
    lost_to_competitor: 0,
    missed_opportunity: 0,
    false_positive: 0,
    correct_rejection: 0,
    needs_more_ratings: 0,
    uncategorized: 0,
  };
  for (const item of items) {
    if (item.failureType) counts[item.failureType]++;
  }
  return counts;
}

// ─── Dataset run data ────────────────────────────────────────────────────────

export async function fetchUploads(): Promise<UploadInfo[]> {
  const { data, error } = await supabase
    .from("review_dashboard_uploads")
    .select("*")
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
  let annotations: any[] = [];
  try {
    annotations = await fetchInBatches<any>("review_dashboard_annotations", "*", "target_id", itemIds, (q) => q.eq("source", "dataset_run"), "dataset_run_annotations");
  } catch {
    // Table may not exist yet
  }

  const annotationMap = new Map<string, Annotation>();
  for (const a of annotations) {
    annotationMap.set(a.target_id, {
      id: a.id,
      seen: a.seen,
      failureModes: a.failure_modes ?? [],
      comment: a.comment,
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
  const counts: Record<FailureType, number> = {
    rated_helpful: 0,
    rated_unhelpful: 0,
    lost_to_competitor: 0,
    missed_opportunity: 0,
    false_positive: 0,
    correct_rejection: 0,
    needs_more_ratings: 0,
    uncategorized: 0,
  };

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
  update: Partial<{ seen: boolean; failureModes: string[]; comment: string }>,
): Promise<void> {
  // Try update first (preserves fields not being changed)
  const { data: existing } = await supabase
    .from("review_dashboard_annotations")
    .select("id")
    .eq("source", source)
    .eq("target_id", targetId)
    .single();

  if (existing) {
    const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (update.seen !== undefined) changes.seen = update.seen;
    if (update.failureModes !== undefined) changes.failure_modes = update.failureModes;
    if (update.comment !== undefined) changes.comment = update.comment;

    const { error } = await supabase
      .from("review_dashboard_annotations")
      .update(changes)
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("review_dashboard_annotations")
      .insert({
        source,
        target_id: targetId,
        seen: update.seen ?? false,
        failure_modes: update.failureModes ?? [],
        comment: update.comment ?? null,
        updated_at: new Date().toISOString(),
      });
    if (error) throw error;
  }
}

// ─── Failure modes catalog ───────────────────────────────────────────────────

export async function fetchFailureModes(): Promise<string[]> {
  const { data, error } = await supabase
    .from("review_dashboard_failure_modes")
    .select("name")
    .order("name");

  if (error) throw error;
  return (data ?? []).map((d: any) => d.name);
}

export async function createFailureMode(name: string): Promise<void> {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return;

  const { error } = await supabase
    .from("review_dashboard_failure_modes")
    .upsert({ name: normalized }, { onConflict: "name" });

  if (error) throw error;
}

/** Delete catalog entries not referenced by any annotation. Returns surviving names. */
export async function pruneUnusedFailureModes(): Promise<string[]> {
  const { data: annotations, error: annErr } = await supabase
    .from("review_dashboard_annotations")
    .select("failure_modes");
  if (annErr) throw annErr;

  const used = new Set((annotations ?? []).flatMap((a: any) => a.failure_modes ?? []));

  const { data: catalog, error: catErr } = await supabase
    .from("review_dashboard_failure_modes")
    .select("name");
  if (catErr) throw catErr;

  const unused = (catalog ?? []).map((d: any) => d.name).filter((n: string) => !used.has(n));
  if (unused.length > 0) {
    const { error } = await supabase
      .from("review_dashboard_failure_modes")
      .delete()
      .in("name", unused);
    if (error) throw error;
  }

  return [...used].sort();
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
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({
      upload_id: upload.id,
      url: r.url ?? "",
      tweet_text: r.text ?? null,
      needs_note: r.needs_note ?? null,
      ground_truth_note: r.ground_truth_note ?? null,
      bot_id: r.bot_id ?? null,
      note_status: r.note_status ?? null,
      outcome: r.outcome ?? null,
      result: r.result ?? null,
      note_text: r.note_text ?? null,
      source_verification: r.source_verification ?? null,
      evaluation_score: r.evaluation_score ? Number(r.evaluation_score) : null,
      logs: r.logs ? (typeof r.logs === "string" ? JSON.parse(r.logs) : r.logs) : null,
    }));

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
