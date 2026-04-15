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

export async function fetchProductionItems(): Promise<ReviewItem[]> {
  // Fetch all our notes, most recent first
  console.log("[data] Loading production items...");
  const notes = await fetchAllRows<any>(
    supabase
      .from("canonical_note_information")
      .select("*"),
    "canonical_note_information"
  );

  if (notes.length === 0) return [];

  const tweetIds = notes.map((n: any) => n.tweet_id);
  const noteIds = notes.map((n: any) => n.note_id);

  // Fetch competing notes, pipeline runs, and annotations in parallel (batched to avoid URL length limits)
  const [competing, pipelines, annotations] = await Promise.all([
    fetchInBatches<any>("competing_notes", "*", "our_note_id", noteIds, undefined, "competing_notes"),
    fetchInBatches<any>("pipeline_runs", "tweet_id, outcome, outcome_reason, logs, search_results, check_reasoning, bot_id", "tweet_id", tweetIds, (q) => q.eq("outcome", "submitted"), "pipeline_runs"),
    fetchInBatches<any>("review_dashboard_annotations", "*", "target_id", noteIds, (q) => q.eq("source", "production"), "annotations").catch(() => [] as any[]),
  ]);

  // Build lookup maps
  const competingByNote = new Map<string, ComparisonNote[]>();
  const helpfulCompetitorNoteIds = new Set<string>();
  for (const cn of competing) {
    const key = cn.our_note_id;
    if (!competingByNote.has(key)) competingByNote.set(key, []);
    competingByNote.get(key)!.push({
      noteId: cn.note_id,
      noteText: cn.note_text,
      status: cn.current_status,
      coreStatus: cn.current_core_status,
      helpfulCount: cn.helpful_count,
      notHelpfulCount: cn.not_helpful_count,
      authorId: cn.author_participant_id,
    });
    if (cn.current_core_status === "CURRENTLY_RATED_HELPFUL") {
      helpfulCompetitorNoteIds.add(key);
    }
  }

  const pipelineByTweet = new Map<string, any>();
  for (const pr of pipelines) {
    pipelineByTweet.set(pr.tweet_id, pr);
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

  const items: ReviewItem[] = notes.map((note: any) => {
    const pipeline = pipelineByTweet.get(note.tweet_id);
    const hasHelpfulCompetitor = helpfulCompetitorNoteIds.has(note.note_id);
    return {
      id: note.note_id,
      source: "production" as const,
      tweetId: note.tweet_id,
      tweetText: note.tweet_text,
      tweetHandle: note.tweet_handle,
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
      logs: pipeline?.logs,
      searchResults: pipeline?.search_results,
      checkReasoning: pipeline?.check_reasoning,
      botId: pipeline?.bot_id,
      comparisonNotes: competingByNote.get(note.note_id) ?? [],
      annotation: annotationByTarget.get(note.note_id),
      failureType: cnStatusToFailureType(note.cn_status, hasHelpfulCompetitor),
    };
  });

  // Fetch unsubmitted candidates (e.g. from local pipeline runs) and show as uncategorized
  const { data: candidateRuns = [], error: candidateErr } = await supabase
    .from("pipeline_runs")
    .select("id, tweet_id, tweet_text, note_text, source_url, bot_id, outcome, outcome_reason, logs, search_results, check_reasoning, created_at")
    .eq("outcome", "candidate")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (candidateErr) console.warn("[data] candidate_pipeline_runs failed:", candidateErr);
  else console.log(`[data] candidate_pipeline_runs: ${candidateRuns.length} rows`);

  const existingTweetIds = new Set(notes.map((n: any) => n.tweet_id));
  for (const pr of candidateRuns) {
    if (existingTweetIds.has(pr.tweet_id)) continue;
    items.push({
      id: `candidate:${pr.id}`,
      source: "production",
      tweetId: pr.tweet_id,
      tweetText: pr.tweet_text,
      noteText: pr.note_text,
      sourceUrl: pr.source_url,
      createdAt: pr.created_at,
      outcome: pr.outcome,
      outcomeReason: pr.outcome_reason,
      logs: pr.logs,
      searchResults: pr.search_results,
      checkReasoning: pr.check_reasoning,
      botId: pr.bot_id,
      comparisonNotes: [],
      failureType: "uncategorized",
    });
  }

  // Fetch and append missed opportunities (non-fatal — column may not exist on prod yet)
  let missed: any[] = [];
  try {
    missed = await fetchAllRows<any>(
      supabase
        .from("competing_notes")
        .select("*, pipeline_runs!competing_notes_pipeline_run_id_fkey(tweet_id, tweet_text, outcome, outcome_reason, logs, created_at)")
        .not("pipeline_run_id", "is", null)
        .eq("current_core_status", "CURRENTLY_RATED_HELPFUL"),
      "missed_opportunities"
    );
  } catch (e) {
    console.warn("Missed opportunities query failed (migration may not be applied yet):", e);
  }

  for (const cn of missed) {
    const pr = cn.pipeline_runs;
    if (!pr) continue;
    items.push({
      id: `missed:${cn.note_id}`,
      source: "production",
      tweetId: cn.tweet_id,
      tweetText: pr.tweet_text,
      noteText: undefined,
      createdAt: pr.created_at,
      outcome: pr.outcome,
      outcomeReason: pr.outcome_reason,
      logs: pr.logs,
      comparisonNotes: [{
        noteId: cn.note_id,
        noteText: cn.note_text,
        status: cn.current_status,
        coreStatus: cn.current_core_status,
        helpfulCount: cn.helpful_count,
        notHelpfulCount: cn.not_helpful_count,
        authorId: cn.author_participant_id,
      }],
      failureType: "missed_opportunity",
    });
  }

  items.sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return db - da;
  });

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
