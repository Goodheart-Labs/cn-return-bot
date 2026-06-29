import { supabase } from "./supabase";
import type {
  ReviewItem,
  ComparisonNote,
  Annotation,
  FailureType,
  UploadInfo,
  FailureModeInfo,
} from "./types";
import { resultToFailureType, FAILURE_TYPE_CONFIG } from "./types";
import { fetchAllRows, fetchInBatches } from "../../../dashboard-shared/supabasePaging";
import { CANONICAL_LIST_COLS, TWEET_LIST_COLS, PUBLIC_DUMP_RATING_COLS, DEFAULT_VIEW_STATUSES, DEFAULT_VIEW_LIMIT } from "../../../dashboard-shared/productionView";
import { csvRowToReviewItemInsert } from "../../../dashboard-shared/reviewUpload";

// ─── Production data ─────────────────────────────────────────────────────────

// A review item's annotation `target_id` encodes which kind of item it is, so a
// single annotations table can key three different sources without collision:
// a bare id is a `notes.note_id` (canonical item); the prefixed forms point at a
// `competing_notes.note_id` (missed opp — never one of our notes) or a
// `pipeline_runs.id` (low-eval rejection — never submitted, so no note row).
// All code that constructs or consumes an item.id MUST go through these helpers.
const MISSED_TARGET_PREFIX = "missed:";
const LOW_EVAL_TARGET_PREFIX = "loweval:";

function missedTargetId(competingNoteId: string): string {
  return `${MISSED_TARGET_PREFIX}${competingNoteId}`;
}

function lowEvalTargetId(pipelineRunId: string): string {
  return `${LOW_EVAL_TARGET_PREFIX}${pipelineRunId}`;
}

type DecodedTarget =
  | { kind: "note"; noteId: string }
  | { kind: "missed"; competingNoteId: string }
  | { kind: "lowEval"; runId: string };

/** Inverse of missedTargetId / lowEvalTargetId. */
function decodeTargetId(targetId: string): DecodedTarget {
  if (targetId.startsWith(MISSED_TARGET_PREFIX))
    return { kind: "missed", competingNoteId: targetId.slice(MISSED_TARGET_PREFIX.length) };
  if (targetId.startsWith(LOW_EVAL_TARGET_PREFIX))
    return { kind: "lowEval", runId: targetId.slice(LOW_EVAL_TARGET_PREFIX.length) };
  return { kind: "note", noteId: targetId };
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
const CANONICAL_LIST_COLUMNS = CANONICAL_LIST_COLS.join(", ");

// pipeline_runs without the logs TOAST column — used for the metadata fetch
// that drives the list. Logs are lazy-loaded per visible card. Tweet text /
// media flags now live on the tweets table; we fetch them separately and
// stitch by tweet_id.
const PIPELINE_METADATA_COLUMNS =
  "id, tweet_id, outcome, outcome_reason, bot_name, created_at, ab_test_picks";

// Low-eval-score rejections were never submitted, so the note text/source live
// on the pipeline_runs row itself rather than on a notes row. Pull those too.
const LOW_EVAL_RUN_COLUMNS =
  "id, tweet_id, note_text, note_status, outcome, outcome_reason, bot_name, created_at, ab_test_picks";

const TWEETS_LIST_COLUMNS = TWEET_LIST_COLS.join(", ");

const PUBLIC_DUMP_RATING_COLUMNS = PUBLIC_DUMP_RATING_COLS.join(", ");

export interface DashboardData {
  canonical: any[];
  competing: any[];
  submittedRuns: any[];
  missedRuns: any[];
  lowEvalRuns: any[];
  lowEvalScores: any[];
  annotations: any[];
  tweets: any[];
  publicDumpRatings: any[];
}

/**
 * The annotation `target_id`s for a primary row set, mirroring the three item
 * shapes buildDashboardItems emits: canonical notes key on note_id, missed
 * opportunities and low-eval rejections on their prefixed encodings.
 */
function annotationTargetIds(
  canonical: any[],
  missedOpps: any[],
  lowEvalRuns: any[],
): string[] {
  return [
    ...canonical.map((n: any) => n.note_id),
    ...missedOpps.map((cn: any) => missedTargetId(cn.note_id)),
    ...lowEvalRuns.map((r: any) => lowEvalTargetId(r.id)),
  ];
}

function fetchAnnotationsForTargets(targetIds: string[]): Promise<any[]> {
  return fetchInBatches<any>(
    supabase, "review_dashboard_annotations", "*", "target_id", targetIds,
    (q) => q.eq("source", "production"), "annotations",
  ).catch(() => [] as any[]);
}

/**
 * Given the three "primary" row sets that anchor a production view — our notes,
 * missed-opportunity competing notes, low-eval rejection runs — fetch all the
 * satellite rows (comparisons, pipeline runs, tweets, ratings, annotations)
 * needed to render them and return the bundle buildDashboardItems consumes.
 *
 * Every satellite query is scoped to these primaries, never the full table —
 * that's what keeps loading fast. The old version pulled the entire
 * competing_notes (~13k), pipeline_runs, and public-ratings tables on every
 * page load. Shared by the date-windowed (fetchDashboardData) and tag-anchored
 * (fetchDashboardDataByTags) loaders. Logs stay the only on-demand fetch
 * (fetchLogsForRuns), per visible card.
 */
async function assembleDashboardData(primary: {
  canonical: any[];
  missedOppCompeting: any[];
  lowEvalRuns: any[];
}): Promise<DashboardData> {
  const { canonical, missedOppCompeting, lowEvalRuns } = primary;
  const noteIds = canonical.map((n: any) => n.note_id);
  const noteTweetIds = [...new Set(canonical.map((n: any) => n.tweet_id).filter(Boolean))];
  // Only competing notes that still qualify become missed-opp items — the tag
  // path fetches them by note_id without the qualifying filters, so re-check.
  const missedOpps = missedOppCompeting.filter(isMissedOppCompetingNote);

  const [comparisonCompeting, submittedRuns, publicDumpRatings, annotations] = await Promise.all([
    // Competing notes attached to our notes — drives the comparison list and the
    // lost-to-competitor classification.
    fetchInBatches<any>(
      supabase, "competing_notes", "*", "our_note_id", noteIds, undefined, "comparison_competing",
    ),
    fetchInBatches<any>(
      supabase, "pipeline_runs", PIPELINE_METADATA_COLUMNS, "tweet_id", noteTweetIds,
      (q) => q.eq("outcome", "submitted"), "submitted_runs",
    ),
    fetchInBatches<any>(
      supabase, "note_ratings_from_public_dump", PUBLIC_DUMP_RATING_COLUMNS, "note_id", noteIds,
      undefined, "public_dump_ratings",
    ),
    fetchAnnotationsForTargets(annotationTargetIds(canonical, missedOpps, lowEvalRuns)),
  ]);

  // Missed opportunities reference specific pipeline_run ids; fetch just those.
  const missedRunIds = [
    ...new Set(missedOpps.map((cn: any) => cn.pipeline_run_id as string)),
  ];
  const missedRuns = missedRunIds.length
    ? await fetchInBatches<any>(
        supabase, "pipeline_runs", PIPELINE_METADATA_COLUMNS, "id", missedRunIds, undefined, "missed_runs",
      )
    : [];

  // The eval score itself lives in pipeline_scores (it isn't mirrored onto
  // pipeline_runs), so fetch it for the low-eval runs to display.
  const lowEvalRunIds = lowEvalRuns.map((r: any) => r.id);
  const lowEvalScores = lowEvalRunIds.length
    ? await fetchInBatches<any>(
        supabase, "pipeline_scores", "pipeline_run_id, score_value", "pipeline_run_id", lowEvalRunIds,
        (q) => q.eq("score_type", "evaluation"), "low_eval_scores",
      )
    : [];

  const competing = [...comparisonCompeting, ...missedOppCompeting];

  // Pull the tweets rows for every tweet_id referenced by the notes or the
  // pipeline_runs we care about. tweets carries text/media/engagement.
  const tweetIds = [
    ...new Set([
      ...noteTweetIds,
      ...submittedRuns.map((r: any) => r.tweet_id).filter(Boolean),
      ...missedRuns.map((r: any) => r.tweet_id).filter(Boolean),
      ...lowEvalRuns.map((r: any) => r.tweet_id).filter(Boolean),
    ]),
  ];
  const tweets = tweetIds.length
    ? await fetchInBatches<any>(
        supabase, "tweets", TWEETS_LIST_COLUMNS, "tweet_id", tweetIds, undefined, "tweets",
      )
    : [];

  return { canonical, competing, submittedRuns, missedRuns, lowEvalRuns, lowEvalScores, annotations, tweets, publicDumpRatings };
}

/**
 * Date-windowed loader: every production item whose note was submitted on or
 * after `sinceIso` (plus missed opps / low-eval rejections in the same window).
 * The window anchor is `notes.submitted_at` (no nulls in that table); keeping
 * the window small is what makes the first paint fast — a 3-day window touches
 * a few hundred rows per table instead of the whole history.
 */
export async function fetchDashboardData(sinceIso: string): Promise<DashboardData> {
  console.log(`[data] Loading dashboard metadata since ${sinceIso}...`);
  const sinceMillis = new Date(sinceIso).getTime();

  const [canonical, missedOppCompeting, lowEvalRuns] = await Promise.all([
    fetchAllRows<any>(
      supabase
        .from("notes")
        .select(CANONICAL_LIST_COLUMNS)
        .gte("submitted_at", sinceIso)
        .order("submitted_at", { ascending: false, nullsFirst: false }),
      "canonical",
    ),
    // Missed opportunities: helpful competitor notes on tweets we rejected.
    // Anchored by the competitor's creation time as a window proxy (the exact
    // item date is the pipeline_run.created_at); a recent rejection of an older
    // competitor can fall outside the window, acceptable for this secondary type.
    fetchAllRows<any>(
      supabase
        .from("competing_notes")
        .select("*")
        .is("our_note_id", null)
        .eq("current_status", "CURRENTLY_RATED_HELPFUL")
        .not("pipeline_run_id", "is", null)
        .gte("created_at_millis", sinceMillis),
      "missed_opp_competing",
    ),
    // Notes rejected by the X eval gate — never submitted, so they aren't in
    // `notes`. Windowed on the run's own created_at.
    fetchAllRows<any>(
      supabase
        .from("pipeline_runs")
        .select(LOW_EVAL_RUN_COLUMNS)
        .eq("outcome_reason", "low_evaluation_score")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false }),
      "low_eval_runs",
    ),
  ]);

  return assembleDashboardData({ canonical, missedOppCompeting, lowEvalRuns });
}

/**
 * Full default-set loader: EVERY note whose cn_status is in `cnStatuses` (the
 * default-on production statuses — today just CURRENTLY_RATED_NOT_HELPFUL), with
 * NO date window, so the reviewer's standard selection is always complete and
 * never needs "load more". Reuses assembleDashboardData, so these notes carry
 * submitted-run ab_test_picks (A/B list-filtering works out of window) and
 * competing data (lost-to-competitor reclassification). The set is small
 * (~hundreds, under one page); `limit` is just a safety cap. Missed opps / low-eval
 * aren't in the default set, so their primaries are empty.
 */
export async function fetchDefaultStatusData(
  cnStatuses: string[] = DEFAULT_VIEW_STATUSES,
  limit: number = DEFAULT_VIEW_LIMIT,
): Promise<DashboardData> {
  console.log(`[data] Loading full default set (${cnStatuses.join("/")})…`);
  const canonical = await fetchAllRows<any>(
    supabase
      .from("notes")
      .select(CANONICAL_LIST_COLUMNS)
      .in("cn_status", cnStatuses)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(limit),
    "default_status_canonical",
  );
  return assembleDashboardData({ canonical, missedOppCompeting: [], lowEvalRuns: [] });
}

/**
 * Tag-anchored loader: every production item ever tagged with one of `tags`,
 * ignoring the date window. Cheap because it starts from the small annotations
 * table (one row per reviewed item) and pulls only the satellite rows for those
 * specific targets — this is what lets the failure-mode pills filter across all
 * time, not just the loaded window. `overlaps` is OR semantics, matching the
 * client-side pill filter (an item matches if it carries any selected tag).
 */
export async function fetchDashboardDataByTags(tags: string[]): Promise<DashboardData> {
  console.log(`[data] Loading all-time items tagged: ${tags.join(", ")}`);

  const taggedAnnotations = await fetchAllRows<any>(
    supabase
      .from("review_dashboard_annotations")
      .select("target_id")
      .eq("source", "production")
      .overlaps("failure_modes", tags),
    "tagged_annotations",
  );

  const noteIds: string[] = [];
  const missedCompetingIds: string[] = [];
  const lowEvalRunIds: string[] = [];
  for (const a of taggedAnnotations) {
    const target = decodeTargetId(a.target_id);
    if (target.kind === "note") noteIds.push(target.noteId);
    else if (target.kind === "missed") missedCompetingIds.push(target.competingNoteId);
    else lowEvalRunIds.push(target.runId);
  }

  const [canonical, missedOppCompeting, lowEvalRuns] = await Promise.all([
    fetchInBatches<any>(supabase, "notes", CANONICAL_LIST_COLUMNS, "note_id", noteIds, undefined, "tagged_canonical"),
    fetchInBatches<any>(supabase, "competing_notes", "*", "note_id", missedCompetingIds, undefined, "tagged_missed_competing"),
    fetchInBatches<any>(supabase, "pipeline_runs", LOW_EVAL_RUN_COLUMNS, "id", lowEvalRunIds, undefined, "tagged_low_eval_runs"),
  ]);

  return assembleDashboardData({ canonical, missedOppCompeting, lowEvalRuns });
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
export function buildDashboardItems(data: DashboardData): ReviewItem[] {
  const { canonical, competing, submittedRuns, missedRuns, lowEvalRuns, lowEvalScores, annotations, tweets, publicDumpRatings } = data;
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
      highValue: a.high_value ?? false,
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

  const evalScoreByRunId = new Map<string, number>();
  for (const s of lowEvalScores) {
    if (s.score_value != null) evalScoreByRunId.set(s.pipeline_run_id, Number(s.score_value));
  }

  for (const run of lowEvalRuns) {
    const tweet = tweetsById.get(run.tweet_id);
    const id = lowEvalTargetId(run.id);
    items.push({
      id,
      source: "production" as const,
      tweetId: run.tweet_id,
      tweetText: tweet?.text,
      tweetHandle: tweet?.author_handle,
      hasPhoto: tweet?.has_photo ?? false,
      hasVideo: tweet?.has_video ?? false,
      mediaCount: tweet?.media_count ?? 0,
      tweetMedia: tweet?.media,
      referencedTweetData: tweet?.referenced_tweet_data,
      noteText: run.note_text,
      createdAt: run.created_at,
      outcome: run.outcome,
      outcomeReason: run.outcome_reason,
      pipelineRunId: run.id,
      botId: run.bot_name,
      abTestPicks: run.ab_test_picks ?? undefined,
      evaluationScore: evalScoreByRunId.get(run.id),
      annotation: annotationByTarget.get(id),
      failureType: "filtered_low_eval_score" as const,
    });
  }

  return items;
}

// ─── Production pill data ────────────────────────────────────────────────────

const PILL_PAGE = 1000;
// Page requests per wave for fetchAllRowsParallel. Local to the dashboard (the
// shared serial fetchAllRows covers everyone else) and used only for the one
// genuinely multi-page scan below.
const PILL_CONCURRENCY = 8;

/**
 * Parallel pagination for the all-time notes scan — the bottleneck of the
 * once-per-session pill-count load. `makeQuery` returns a FRESH query each call
 * (concurrent `.range()`s can't share a builder) with a stable ORDER BY so the
 * page ranges partition the same ordered set. Worth it only for multi-page tables;
 * the other count scans are single-page and stay on serial fetchAllRows.
 */
async function fetchAllRowsParallel<T>(makeQuery: () => any, label?: string): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  let done = false;
  while (!done) {
    const ranges: Array<[number, number]> = [];
    for (let k = 0; k < PILL_CONCURRENCY; k++) {
      ranges.push([offset, offset + PILL_PAGE - 1]);
      offset += PILL_PAGE;
    }
    const pages = await Promise.all(ranges.map(([from, to]) => makeQuery().range(from, to)));
    for (const { data, error } of pages) {
      if (error) throw error;
      if (data && data.length) all.push(...(data as T[]));
      if (!data || data.length < PILL_PAGE) done = true;
    }
  }
  if (label) console.log(`[data] ${label}: ${all.length} rows`);
  return all;
}

type AbPicks = Record<string, string> | null;

export interface ProductionPillData {
  // All-time category counts for the filter-bar pills.
  counts: Record<FailureType, number>;
  // All-time tag usage counts for the failure-mode pills.
  tagCounts: Map<string, number>;
  // Per-note {noteId, failureType, seen, abTestPicks}, all-time — lets the UI
  // recompute the rated pills under the seen + A/B filters ("how many left to
  // review" in this variant, not the all-time total). noteId so the UI can
  // override with live state for loaded notes.
  notesSeen: { noteId: string; failureType: FailureType; seen: boolean; abTestPicks: AbPicks }[];
  // Per-annotation {targetId, failureModes, seen, abTestPicks}, all-time — same,
  // for tag pills.
  annotationsSeen: { targetId: string; failureModes: string[]; seen: boolean; abTestPicks: AbPicks }[];
}

/**
 * All-time data behind the filter-bar pills, in one pass. Deliberately NOT
 * windowed — the list shows the last N days, but the pills report the full
 * picture, so "Rated Helpful 475" doesn't shrink to whatever happens to be
 * loaded. Carries each note's / annotation's `seen` flag so the UI can render
 * seen-aware counts without re-fetching. Cheap: only the tiny columns needed to
 * classify (no text, no TOAST). Classification mirrors buildDashboardItems via
 * `cnStatusToFailureType`.
 */
export async function fetchProductionPillData(): Promise<ProductionPillData> {
  const [notes, helpfulCompeting, missed, lowEval, annotationRows, abRuns] = await Promise.all([
    // The notes scan is the bottleneck of this once-per-session load (~4 pages);
    // paginate it in parallel. The others are single-page, so they stay serial.
    // Stable ORDER BY note_id so the concurrent page ranges partition cleanly.
    fetchAllRowsParallel<any>(
      () => supabase.from("notes").select("note_id, cn_status, tweet_id").order("note_id", { ascending: true }),
      "count_notes",
    ),
    fetchAllRows<any>(
      supabase
        .from("competing_notes")
        .select("our_note_id")
        .eq("current_status", "CURRENTLY_RATED_HELPFUL")
        .not("our_note_id", "is", null),
      "count_helpful_competing",
    ),
    supabase
      .from("competing_notes")
      .select("note_id", { count: "exact", head: true })
      .is("our_note_id", null)
      .eq("current_status", "CURRENTLY_RATED_HELPFUL")
      .not("pipeline_run_id", "is", null),
    supabase
      .from("pipeline_runs")
      .select("id", { count: "exact", head: true })
      .eq("outcome_reason", "low_evaluation_score"),
    fetchAllRows<any>(
      supabase
        .from("review_dashboard_annotations")
        .select("target_id, seen, failure_modes")
        .eq("source", "production"),
      "production_annotations",
    ),
    // A/B picks per note for A/B-aware pill counts. Keyed by tweet_id off the
    // submitted run, mirroring buildDashboardItems; only runs that carry picks,
    // so it stays small (notes without picks just never match an A/B filter).
    fetchAllRows<any>(
      supabase
        .from("pipeline_runs")
        .select("tweet_id, ab_test_picks")
        .eq("outcome", "submitted")
        .not("ab_test_picks", "is", null),
      "ab_picks",
    ),
  ]);

  const helpfulCompetitorNoteIds = new Set(helpfulCompeting.map((c: any) => c.our_note_id));
  const seenByTargetId = new Map<string, boolean>();
  for (const a of annotationRows) seenByTargetId.set(a.target_id, !!a.seen);
  const abPicksByTweet = new Map<string, AbPicks>();
  for (const r of abRuns) abPicksByTweet.set(r.tweet_id, r.ab_test_picks ?? null);
  const tweetByNoteId = new Map<string, string>();
  for (const note of notes) tweetByNoteId.set(note.note_id, note.tweet_id);
  const picksForNoteId = (noteId: string): AbPicks => abPicksByTweet.get(tweetByNoteId.get(noteId) ?? "") ?? null;

  const counts = Object.fromEntries(
    Object.keys(FAILURE_TYPE_CONFIG).map((k) => [k, 0]),
  ) as Record<FailureType, number>;
  const notesSeen: ProductionPillData["notesSeen"] = [];
  for (const note of notes) {
    const failureType = cnStatusToFailureType(note.cn_status, helpfulCompetitorNoteIds.has(note.note_id));
    counts[failureType]++;
    notesSeen.push({
      noteId: note.note_id,
      failureType,
      seen: seenByTargetId.get(note.note_id) ?? false,
      abTestPicks: abPicksByTweet.get(note.tweet_id) ?? null,
    });
  }
  counts.missed_opportunity = missed.count ?? 0;
  counts.filtered_low_eval_score = lowEval.count ?? 0;

  const tagCounts = new Map<string, number>();
  const annotationsSeen: ProductionPillData["annotationsSeen"] = [];
  for (const a of annotationRows) {
    const failureModes = a.failure_modes ?? [];
    for (const m of failureModes) tagCounts.set(m, (tagCounts.get(m) ?? 0) + 1);
    // target_id is a bare note_id for canonical notes (the common case); prefixed
    // missed/low-eval targets have no note tweet, so no A/B picks.
    annotationsSeen.push({ targetId: a.target_id, failureModes, seen: !!a.seen, abTestPicks: picksForNoteId(a.target_id) });
  }

  return { counts, tagCounts, notesSeen, annotationsSeen };
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
    if (update.highValue !== undefined) changes.high_value = update.highValue;

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
        high_value: update.highValue ?? false,
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
