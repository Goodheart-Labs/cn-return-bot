import { supabase } from "./supabase";
import type {
  ReviewItem,
  ComparisonNote,
  Annotation,
  FailureType,
  UploadInfo,
  FailureModeInfo,
} from "./types";
import { resultToFailureType } from "./types";
import { fetchAllRows, fetchInBatches } from "../../../dashboard-shared/supabasePaging";

// ─── Production data ─────────────────────────────────────────────────────────

/**
 * Encoded `target_id` for a missed-opportunity review item. The prefix lets a
 * single annotations table key both `notes.note_id` (canonical items) and
 * `competing_notes.note_id` (missed-opportunity items) without collision.
 * All code that constructs or consumes a missed-opp item.id MUST go through
 * this helper.
 */
function missedTargetId(competingNoteId: string): string {
  return `missed:${competingNoteId}`;
}

/**
 * A competing_notes row represents a missed opportunity when it has no
 * associated note from us, the competing note got rated helpful, and we have
 * a pipeline_run id to point back to the rejection.
 */
function isMissedOppCompetingNote(cn: any): boolean {
  return (
    cn.our_note_id === null &&
    cn.current_status === "CURRENTLY_RATED_HELPFUL" &&
    !!cn.pipeline_run_id
  );
}

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

// Columns needed to render the production list. After the canonical→notes
// merge, tweet text/handle and current_core_status no longer live on this
// table — text comes from tweets (joined by tweet_id), and we prefer
// current_status (cn_status) per CLAUDE.md.
const CANONICAL_LIST_COLUMNS = [
  "note_id",
  "tweet_id",
  "note_text",
  "source_url",
  "submitted_at",
  "first_seen_at",
  "cn_status",
  "view_count",
  "rating_count",
  "helpful_count",
  "not_helpful_count",
].join(", ");

// pipeline_runs without the logs TOAST column — used for the metadata fetch
// that drives the list. Logs are lazy-loaded per visible card. Tweet text /
// media flags now live on the tweets table; we fetch them separately and
// stitch by tweet_id.
const PIPELINE_METADATA_COLUMNS =
  "id, tweet_id, outcome, outcome_reason, bot_name, created_at, ab_test_picks";

const TWEETS_LIST_COLUMNS =
  "tweet_id, text, media, referenced_tweet_data, author_handle, has_photo, has_video, media_count";

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
  tweets: any[];
  publicDumpRatings: any[];
}> {
  console.log("[data] Loading dashboard metadata...");
  const [canonical, competing, submittedRuns, publicDumpRatings] = await Promise.all([
    fetchAllRows<any>(
      supabase
        .from("notes")
        .select(CANONICAL_LIST_COLUMNS)
        .order("submitted_at", { ascending: false, nullsFirst: false }),
      "canonical",
    ),
    fetchAllRows<any>(supabase.from("competing_notes").select("*"), "competing"),
    fetchAllRows<any>(
      supabase.from("pipeline_runs").select(PIPELINE_METADATA_COLUMNS).eq("outcome", "submitted"),
      "submitted_runs",
    ),
    fetchAllRows<any>(
      supabase
        .from("note_ratings_from_public_dump")
        .select("note_id, helpful_count, somewhat_helpful_count, not_helpful_count, helpful_tag_counts, not_helpful_tag_counts, dump_date"),
      "public_dump_ratings",
    ),
  ]);

  // Missed opportunities reference specific pipeline_run ids; fetch just those
  // (avoids pulling the full rejected-runs table, which is ~20k rows).
  const missedOpps = competing.filter(isMissedOppCompetingNote);
  const missedRunIds = [
    ...new Set(missedOpps.map((cn: any) => cn.pipeline_run_id as string)),
  ];
  const missedRuns = missedRunIds.length
    ? await fetchInBatches<any>(
        supabase,
        "pipeline_runs",
        PIPELINE_METADATA_COLUMNS,
        "id",
        missedRunIds,
        undefined,
        "missed_runs",
      )
    : [];

  // Pull the tweets rows for every tweet_id that appears in canonical or in
  // either set of pipeline_runs we care about. tweets carries text/media/
  // engagement after the schema cleanup.
  const tweetIds = [
    ...new Set([
      ...canonical.map((n: any) => n.tweet_id).filter(Boolean),
      ...submittedRuns.map((r: any) => r.tweet_id).filter(Boolean),
      ...missedRuns.map((r: any) => r.tweet_id).filter(Boolean),
    ]),
  ];
  const tweets = tweetIds.length
    ? await fetchInBatches<any>(
        supabase,
        "tweets",
        TWEETS_LIST_COLUMNS,
        "tweet_id",
        tweetIds,
        undefined,
        "tweets",
      )
    : [];

  // Annotations are keyed by item.id: canonical items use note_id directly,
  // missed-opportunity items use the missedTargetId() encoding. Include both
  // shapes so tags applied to missed-opp cards survive reloads.
  const annotationTargetIds = [
    ...canonical.map((n: any) => n.note_id),
    ...missedOpps.map((cn: any) => missedTargetId(cn.note_id)),
  ];
  const annotations = await fetchInBatches<any>(
    supabase,
    "review_dashboard_annotations",
    "*",
    "target_id",
    annotationTargetIds,
    (q) => q.eq("source", "production"),
    "annotations",
  ).catch(() => [] as any[]);

  return { canonical, competing, submittedRuns, missedRuns, annotations, tweets, publicDumpRatings };
}

/**
 * Fetch the full JSONB `logs` for a set of pipeline_run ids. Called by the UI
 * when a card becomes visible so we only pay the TOAST cost for rows the user
 * actually sees, not every note we've ever written.
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
  tweets: any[];
  publicDumpRatings: any[];
}): ReviewItem[] {
  const { canonical, competing, submittedRuns, missedRuns, annotations, tweets, publicDumpRatings } = data;
  const publicRatingsByNoteId = new Map<string, any>();
  for (const r of publicDumpRatings) publicRatingsByNoteId.set(r.note_id, r);

  const pipelineByTweet = new Map<string, any>();
  for (const pr of submittedRuns) pipelineByTweet.set(pr.tweet_id, pr);

  const pipelineById = new Map<string, any>();
  for (const pr of missedRuns) pipelineById.set(pr.id, pr);

  const tweetsById = new Map<string, any>();
  for (const t of tweets) tweetsById.set(t.tweet_id, t);

  const competingByOurNote = new Map<string, ComparisonNote[]>();
  const helpfulCompetitorNoteIds = new Set<string>();
  for (const cn of competing) {
    if (cn.our_note_id == null) continue;
    if (!competingByOurNote.has(cn.our_note_id)) competingByOurNote.set(cn.our_note_id, []);
    competingByOurNote.get(cn.our_note_id)!.push({
      noteId: cn.note_id,
      noteText: cn.note_text,
      status: cn.current_status,
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
    const tweet = tweetsById.get(note.tweet_id);
    const hasHelpfulCompetitor = helpfulCompetitorNoteIds.has(note.note_id);
    const compNotes = competingByOurNote.get(note.note_id) ?? [];
    const failureType = cnStatusToFailureType(note.cn_status, hasHelpfulCompetitor);
    items.push({
      id: note.note_id,
      source: "production" as const,
      tweetId: note.tweet_id,
      tweetText: tweet?.text,
      tweetHandle: tweet?.author_handle,
      hasPhoto: tweet?.has_photo ?? false,
      hasVideo: tweet?.has_video ?? false,
      mediaCount: tweet?.media_count ?? 0,
      tweetMedia: tweet?.media,
      referencedTweetData: tweet?.referenced_tweet_data,
      noteId: note.note_id,
      noteText: note.note_text,
      sourceUrl: note.source_url,
      createdAt: note.submitted_at ?? note.first_seen_at,
      status: note.cn_status,
      viewCount: note.view_count,
      ratingCount: note.rating_count,
      helpfulCount: note.helpful_count,
      notHelpfulCount: note.not_helpful_count,
      publicDumpRatings: publicRatingsByNoteId.get(note.note_id),
      outcome: pipeline?.outcome,
      outcomeReason: pipeline?.outcome_reason,
      pipelineRunId: pipeline?.id,
      botId: pipeline?.bot_name,
      abTestPicks: pipeline?.ab_test_picks ?? undefined,
      comparisonNotes: compNotes,
      annotation: annotationByTarget.get(note.note_id),
      competitorLeadTag: failureType === "lost_to_competitor"
        ? computeCompetitorLeadTag(note.submitted_at ?? note.first_seen_at, compNotes)
        : undefined,
      failureType,
    });
  }

  for (const cn of competing) {
    if (!isMissedOppCompetingNote(cn)) continue;
    const pr = pipelineById.get(cn.pipeline_run_id);
    if (!pr) continue;
    const tweet = tweetsById.get(cn.tweet_id);
    const id = missedTargetId(cn.note_id);
    items.push({
      id,
      source: "production" as const,
      tweetId: cn.tweet_id,
      tweetText: tweet?.text,
      tweetMedia: tweet?.media,
      referencedTweetData: tweet?.referenced_tweet_data,
      noteText: undefined,
      createdAt: pr.created_at,
      outcome: pr.outcome,
      outcomeReason: pr.outcome_reason,
      pipelineRunId: pr.id,
      abTestPicks: pr.ab_test_picks ?? undefined,
      comparisonNotes: [
        {
          noteId: cn.note_id,
          noteText: cn.note_text,
          status: cn.current_status,
          authorId: cn.author_participant_id,
        },
      ],
      annotation: annotationByTarget.get(id),
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
    annotations = await fetchInBatches<any>(supabase, "review_dashboard_annotations", "*", "target_id", itemIds, (q) => q.eq("source", "dataset_run"), "dataset_run_annotations");
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
