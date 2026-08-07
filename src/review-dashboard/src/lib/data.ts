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
import { resolveRatingCounts } from "../../../dashboard-shared/Ratings";
import { fetchAllRows, fetchInBatches } from "../../../dashboard-shared/supabasePaging";
import { CANONICAL_LIST_COLS, TWEET_LIST_COLS, PUBLIC_DUMP_RATING_COLS, DEFAULT_VIEW_STATUSES, DEFAULT_VIEW_LIMIT } from "../../../dashboard-shared/productionView";
import { csvRowToReviewItemInsert } from "../../../dashboard-shared/reviewUpload";
import { topicSetFor } from "../../../dashboard-shared/topicSets";

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
  isUnderwater: boolean,
): FailureType {
  if (cnStatus === "CURRENTLY_RATED_HELPFUL") return "rated_helpful";
  if (cnStatus === "CURRENTLY_RATED_NOT_HELPFUL") return "rated_unhelpful";
  if (hasHelpfulCompetitor) return "lost_to_competitor";
  if (cnStatus === "NEEDS_MORE_RATINGS") return isUnderwater ? "underwater" : "needs_more_ratings";
  return "uncategorized";
}

// "Underwater": a NEEDS_MORE_RATINGS note that, once it has enough ratings,
// scores below Community Notes' own display bar. CN encodes each rating
// Helpful=1 / Somewhat=0.5 / Not=0 and publishes a note when its
// leniency-adjusted intercept clears 0.4. We can't see that adjusted intercept
// (it needs the full rater matrix), so we approximate it with the raw weighted
// average of the public rating counts. The threshold sits well below CN's 0.4
// bar: at 0.4 at the time there were ~575 notes; 0.2
// keeps had only ~170 (tuned by feel 2026-07-14). Tightening
// the threshold rather than the min-ratings floor keeps the pill
// view-count-neutral (a floor skews it toward high-traffic notes). Notes with
// fewer than UNDERWATER_MIN_RATINGS ratings stay "Needs More Ratings" —
// genuinely undecided, not sunk. Helpful/not-helpful use the card badge's
// resolution rule (public-dump first, scraped fallback); somewhat comes from
// the public dump only.
const UNDERWATER_RATIO_THRESHOLD = 0.2;
const UNDERWATER_MIN_RATINGS = 5;
function isUnderwaterNote(
  publicDumpRatings:
    | { helpful_count?: number | null; somewhat_helpful_count?: number | null; not_helpful_count?: number | null }
    | null
    | undefined,
  helpfulCount: number | null | undefined,
  notHelpfulCount: number | null | undefined,
): boolean {
  const { helpful, notHelpful } = resolveRatingCounts(
    publicDumpRatings as any,
    helpfulCount,
    notHelpfulCount,
  );
  const somewhat = publicDumpRatings?.somewhat_helpful_count ?? 0;
  const total = helpful + somewhat + notHelpful;
  if (total < UNDERWATER_MIN_RATINGS) return false;
  return (helpful + 0.5 * somewhat) / total < UNDERWATER_RATIO_THRESHOLD;
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

// Notes the bot WROTE but never submitted — the cap was hit, or a pre-submit
// check failed. Their text lives on the pipeline_run (no notes row), exactly like
// low-eval rejections, so they ride the same recovery path and get tagged
// isDraft + failureType "draft_not_posted" in buildDashboardItems.
const DRAFT_OUTCOME_REASONS = ["daily_limit_reached", "check_failed"];
// Every never-submitted reason whose note_text we surface in the list: low-eval
// (already shown) plus the drafts above. One `.in()` fetch covers all three.
const REJECTION_OUTCOME_REASONS = ["low_evaluation_score", ...DRAFT_OUTCOME_REASONS];

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
  // Misinfo-monitoring sightings (tweet_id → topic_id) for the visible tweets,
  // so items can carry their fact-check topic + derived set.
  sightings: any[];
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

  // Each satellite is fail-soft: on error it degrades to [] rather than throwing,
  // so a single slow/failed enrichment query can't blank the whole note list —
  // the notes always render (with reduced classification/comparison detail).
  const softBatch = (p: Promise<any[]>, what: string) =>
    p.catch((e) => { console.warn(`[data] ${what} failed — degrading:`, e); return [] as any[]; });
  // Every id needed below is derivable from the primary fetch, so ALL satellites
  // run in ONE parallel wave (they used to be five serial awaits — tweet text
  // landed 4 round-trips after the notes painted; Nathan, 2026-07-29). Tweet ids
  // discovered on runs (rare) get a tiny top-up fetch after the wave.
  const missedRunIds = [
    ...new Set(missedOpps.map((cn: any) => cn.pipeline_run_id as string)),
  ];
  const lowEvalRunIds = lowEvalRuns.map((r: any) => r.id);
  const knownTweetIds = [
    ...new Set([...noteTweetIds, ...lowEvalRuns.map((r: any) => r.tweet_id).filter(Boolean)]),
  ];
  const [comparisonCompeting, submittedRuns, publicDumpRatings, annotations, missedRuns, lowEvalScores, tweetsMain, sightingsMain] = await Promise.all([
    // Competing notes attached to our notes — drives the comparison list and the
    // lost-to-competitor classification.
    softBatch(fetchInBatches<any>(
      // Only the columns buildDashboardItems reads — "*" pulled every column
      // (incl. big text) for ~8k rows and was the dominant cost of the all-notes load.
      supabase, "competing_notes", "note_id, our_note_id, note_text, current_status, author_participant_id, created_at_millis", "our_note_id", noteIds, undefined, "comparison_competing",
    ), "competing_notes"),
    softBatch(fetchInBatches<any>(
      supabase, "pipeline_runs", PIPELINE_METADATA_COLUMNS, "tweet_id", noteTweetIds,
      (q) => q.eq("outcome", "submitted"), "submitted_runs",
    ), "submitted_runs"),
    softBatch(fetchInBatches<any>(
      supabase, "note_ratings_from_public_dump", PUBLIC_DUMP_RATING_COLUMNS, "note_id", noteIds,
      undefined, "public_dump_ratings",
    ), "public_dump_ratings"),
    fetchAnnotationsForTargets(annotationTargetIds(canonical, missedOpps, lowEvalRuns)),
    // Missed opportunities reference specific pipeline_run ids; fetch just those.
    missedRunIds.length
      ? fetchInBatches<any>(supabase, "pipeline_runs", PIPELINE_METADATA_COLUMNS, "id", missedRunIds, undefined, "missed_runs")
      : Promise.resolve([] as any[]),
    // The eval score itself lives in pipeline_scores (it isn't mirrored onto
    // pipeline_runs), so fetch it for the low-eval runs to display.
    lowEvalRunIds.length
      ? fetchInBatches<any>(
          supabase, "pipeline_scores", "pipeline_run_id, score_value", "pipeline_run_id", lowEvalRunIds,
          (q) => q.eq("score_type", "evaluation"), "low_eval_scores",
        )
      : Promise.resolve([] as any[]),
    // tweets carries text/media/engagement — the note cards' tweet boxes.
    knownTweetIds.length
      ? softBatch(fetchInBatches<any>(supabase, "tweets", TWEETS_LIST_COLUMNS, "tweet_id", knownTweetIds, undefined, "tweets"), "tweets")
      : Promise.resolve([] as any[]),
    // Misinfo-monitoring sightings for these tweets → each item's fact-check topic.
    knownTweetIds.length
      ? fetchInBatches<any>(supabase, "misinfo_monitoring_sightings", "tweet_id, topic_id", "tweet_id", knownTweetIds, undefined, "misinfo_sightings").catch(() => [] as any[])
      : Promise.resolve([] as any[]),
  ]);

  const competing = [...comparisonCompeting, ...missedOppCompeting];

  // Top-up: tweet ids that only appear on the fetched runs (not on any note).
  const knownTweetIdSet = new Set(knownTweetIds);
  const extraTweetIds = [
    ...new Set(
      [...submittedRuns, ...missedRuns].map((r: any) => r.tweet_id).filter((id: any) => id && !knownTweetIdSet.has(id)),
    ),
  ];
  const [tweetsExtra, sightingsExtra] = extraTweetIds.length
    ? await Promise.all([
        softBatch(fetchInBatches<any>(supabase, "tweets", TWEETS_LIST_COLUMNS, "tweet_id", extraTweetIds, undefined, "tweets_extra"), "tweets_extra"),
        fetchInBatches<any>(supabase, "misinfo_monitoring_sightings", "tweet_id, topic_id", "tweet_id", extraTweetIds, undefined, "misinfo_sightings_extra").catch(() => [] as any[]),
      ])
    : [[] as any[], [] as any[]];
  const tweets = [...tweetsMain, ...tweetsExtra];
  const sightings = [...sightingsMain, ...sightingsExtra];

  return { canonical, competing, submittedRuns, missedRuns, lowEvalRuns, lowEvalScores, annotations, tweets, publicDumpRatings, sightings };
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
    // Narrow columns (a select-* scan here can exceed the DB statement timeout
    // under the initial load's parallel queries) and fail-soft: a missing
    // secondary item type must degrade the view, not reject the whole load.
    fetchAllRows<any>(
      supabase
        .from("competing_notes")
        .select("note_id, our_note_id, current_status, pipeline_run_id, tweet_id, note_text, author_participant_id, created_at_millis")
        .is("our_note_id", null)
        .eq("current_status", "CURRENTLY_RATED_HELPFUL")
        .not("pipeline_run_id", "is", null)
        .gte("created_at_millis", sinceMillis),
      "missed_opp_competing",
    ).catch((err) => {
      console.warn("[data] missed_opp_competing failed; continuing without missed opps:", err);
      return [] as any[];
    }),
    // Notes written but never submitted — low-eval rejections PLUS drafts (cap
    // hit / check failed). Not in `notes`; text lives on the run. Windowed on the
    // run's own created_at. buildDashboardItems splits them by outcome_reason.
    fetchAllRows<any>(
      supabase
        .from("pipeline_runs")
        .select(LOW_EVAL_RUN_COLUMNS)
        .in("outcome_reason", REJECTION_OUTCOME_REASONS)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false }),
      "rejection_runs",
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
 * Load EVERY note, ALL statuses, NO date window — so the reviewer sees the full
 * picture (~6k notes, incl. the ~85% freshly-submitted NEEDS_MORE_RATINGS ones the
 * status-default view hides), topic/status filters are authoritative, and "0 of a
 * thing" genuinely means zero. Small enough to load whole in one pass; the
 * satellite fetches are batched by assembleDashboardData, so no single query
 * exceeds the DB statement timeout (the old windowed load's failure mode).
 */
export async function fetchAllNotesCanonical(): Promise<any[]> {
  console.log("[data] Loading ALL notes (canonical, every status, no window)…");
  // PostgREST caps every response at 1000 rows, so a single select silently
  // truncates. Page it in PARALLEL (fetchAllRowsParallel: 8 concurrent .range()s)
  // — gets all ~6k in ~2s, vs serial offset paging which re-sorts per page (~10s).
  // Stable ORDER BY note_id so the concurrent page ranges partition cleanly; the
  // client re-sorts by date (sortedItems).
  return fetchAllRowsParallel<any>(
    () => supabase.from("notes").select(CANONICAL_LIST_COLUMNS).order("note_id", { ascending: true }),
    "all_notes_canonical",
  );
}

/**
 * Phase-1 render data: the note rows + all production seen-annotations — both a
 * single fast query. Lets the list paint in ~2–3s (note text, status, correct
 * seen/unseen) while the heavy per-note satellites (tweets, competing, ratings,
 * sightings) load in the background via assembleAllNotes. Fetching every satellite
 * for all ~6k notes up front took ~30s — this is the "quick load, slow background".
 */
export async function fetchAllNotesPhase1(canonical: any[]): Promise<DashboardData> {
  // All production annotations in one shot (small table, ~hundreds of rows) — far
  // faster than batching by note_id; buildDashboardItems matches them by target_id.
  const annotations = await fetchAllRows<any>(
    supabase.from("review_dashboard_annotations").select("*").eq("source", "production"),
    "phase1_annotations",
  ).catch(() => [] as any[]);
  return { canonical, competing: [], submittedRuns: [], missedRuns: [], lowEvalRuns: [], lowEvalScores: [], annotations, tweets: [], publicDumpRatings: [], sightings: [] };
}

/** Phase-2 enrichment: attach every satellite (batched, fail-soft) to the notes. */
export async function assembleAllNotes(canonical: any[]): Promise<DashboardData> {
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
 * High-value-anchored loader: every production item ever starred high-value,
 * ignoring the date window. Same shape as fetchDashboardDataByTags — starts from
 * the small annotations table (`high_value = true`) and pulls only the satellite
 * rows for those targets — so the "Great notes" filter spans all time, not just
 * the loaded window (a starred note can be any status/age, not only the fully-
 * loaded rated-helpful set).
 */
export async function fetchDashboardDataHighValue(): Promise<DashboardData> {
  console.log("[data] Loading all-time high-value (starred) items");

  const starredAnnotations = await fetchAllRows<any>(
    supabase
      .from("review_dashboard_annotations")
      .select("target_id")
      .eq("source", "production")
      .eq("high_value", true),
    "high_value_annotations",
  );

  const noteIds: string[] = [];
  const missedCompetingIds: string[] = [];
  const lowEvalRunIds: string[] = [];
  for (const a of starredAnnotations) {
    const target = decodeTargetId(a.target_id);
    if (target.kind === "note") noteIds.push(target.noteId);
    else if (target.kind === "missed") missedCompetingIds.push(target.competingNoteId);
    else lowEvalRunIds.push(target.runId);
  }

  const [canonical, missedOppCompeting, lowEvalRuns] = await Promise.all([
    fetchInBatches<any>(supabase, "notes", CANONICAL_LIST_COLUMNS, "note_id", noteIds, undefined, "high_value_canonical"),
    fetchInBatches<any>(supabase, "competing_notes", "*", "note_id", missedCompetingIds, undefined, "high_value_missed_competing"),
    fetchInBatches<any>(supabase, "pipeline_runs", LOW_EVAL_RUN_COLUMNS, "id", lowEvalRunIds, undefined, "high_value_low_eval_runs"),
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
  const { canonical, competing, submittedRuns, missedRuns, lowEvalRuns, lowEvalScores, annotations, tweets, publicDumpRatings, sightings } = data;
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
    const publicDump = publicRatingsByNoteId.get(note.note_id);
    const failureType = cnStatusToFailureType(
      note.cn_status,
      hasHelpfulCompetitor,
      isUnderwaterNote(publicDump, note.helpful_count, note.not_helpful_count),
    );
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
      publicDumpRatings: publicDump,
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
    // Split the never-submitted reasons: cap-hit (a good note that lost the slot)
    // and check-failed both render as drafts; low-eval keeps its own category.
    const draftType: FailureType | null =
      run.outcome_reason === "daily_limit_reached" ? "filtered_no_slot"
        : run.outcome_reason === "check_failed" ? "draft_check_failed"
          : null;
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
      isDraft: draftType != null || undefined,
      failureType: draftType ?? ("filtered_low_eval_score" as const),
    });
  }

  // Attach each item's misinfo fact-check topic + derived set (one pass; covers
  // all item sources). Regular notes have no sighting → topic stays undefined.
  // `sightings` may be absent on the server-injected first-paint bundle (which
  // predates this field), so default to [] rather than crash.
  const topicByTweet = new Map<string, string>();
  for (const s of sightings ?? []) {
    if (s.tweet_id && s.topic_id) topicByTweet.set(String(s.tweet_id), String(s.topic_id));
  }
  for (const item of items) {
    const topic = topicByTweet.get(String(item.tweetId));
    if (topic) {
      item.topic = topic;
      item.topicSet = topicSetFor(topic);
    }
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
  // Tag usage over notes submitted in the last 30 days — sorts the per-card
  // failure-mode selector so its order tracks current failure patterns.
  tagCounts30d: Map<string, number>;
  // Per-note {noteId, failureType, seen, abTestPicks}, all-time — lets the UI
  // recompute the rated pills under the seen + A/B filters ("how many left to
  // review" in this variant, not the all-time total). noteId so the UI can
  // override with live state for loaded notes.
  notesSeen: { noteId: string; failureType: FailureType; seen: boolean; abTestPicks: AbPicks; submittedAt: string | null }[];
  // Per-annotation {targetId, failureModes, seen, abTestPicks}, all-time — same,
  // for tag pills. updatedAt (= when seen was last toggled) feeds the burndown
  // bar's recent review-pace estimate.
  annotationsSeen: { targetId: string; failureModes: string[]; seen: boolean; abTestPicks: AbPicks; updatedAt: string | null }[];
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
  const [notes, publicRatings, helpfulCompeting, missed, lowEval, noSlot, checkFailed, annotationRows, abRuns] = await Promise.all([
    // The notes scan is the bottleneck of this once-per-session load (~4 pages);
    // paginate it in parallel. The others are single-page, so they stay serial.
    // Stable ORDER BY note_id so the concurrent page ranges partition cleanly.
    // helpful/not_helpful counts feed the underwater classification.
    fetchAllRowsParallel<any>(
      () => supabase.from("notes").select("note_id, cn_status, tweet_id, helpful_count, not_helpful_count, submitted_at").order("note_id", { ascending: true }),
      "count_notes",
    ),
    // Public-dump rating counts for every note, so the underwater pill count uses
    // the same public-dump-first resolution as the loaded cards. Counts-only
    // columns (no tag JSONBs) keep the scan cheap.
    fetchAllRowsParallel<any>(
      () => supabase.from("note_ratings_from_public_dump").select("note_id, helpful_count, somewhat_helpful_count, not_helpful_count").order("note_id", { ascending: true }),
      "count_public_ratings",
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
    // Estimated, not exact: an exact count is an un-indexed scan over all of
    // pipeline_runs and reliably exceeds the DB statement timeout (the pill
    // then silently shows 0). The planner estimate is close enough for a pill.
    supabase
      .from("pipeline_runs")
      .select("id", { count: "estimated", head: true })
      .eq("outcome_reason", "low_evaluation_score"),
    // Estimated counts for the two draft pills, split by reason (cap-hit vs check-failed).
    supabase
      .from("pipeline_runs")
      .select("id", { count: "estimated", head: true })
      .eq("outcome_reason", "daily_limit_reached"),
    supabase
      .from("pipeline_runs")
      .select("id", { count: "estimated", head: true })
      .eq("outcome_reason", "check_failed"),
    fetchAllRows<any>(
      supabase
        .from("review_dashboard_annotations")
        .select("target_id, seen, failure_modes, updated_at")
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
  const publicRatingsByNoteId = new Map<string, any>();
  for (const r of publicRatings) publicRatingsByNoteId.set(r.note_id, r);
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
    const failureType = cnStatusToFailureType(
      note.cn_status,
      helpfulCompetitorNoteIds.has(note.note_id),
      isUnderwaterNote(publicRatingsByNoteId.get(note.note_id), note.helpful_count, note.not_helpful_count),
    );
    counts[failureType]++;
    notesSeen.push({
      noteId: note.note_id,
      failureType,
      seen: seenByTargetId.get(note.note_id) ?? false,
      abTestPicks: abPicksByTweet.get(note.tweet_id) ?? null,
      submittedAt: note.submitted_at ?? null,
    });
  }
  counts.missed_opportunity = missed.count ?? 0;
  counts.filtered_low_eval_score = lowEval.count ?? 0;
  counts.filtered_no_slot = noSlot.count ?? 0;
  counts.draft_check_failed = checkFailed.count ?? 0;

  const tagCounts = new Map<string, number>();
  const tagCounts30d = new Map<string, number>();
  // Last-30-days window for the card selector's sort: tags on notes submitted in
  // the last month track what's going wrong NOW; retired failure modes sink
  // (Nathan, 2026-07-28). Keyed on the note's submitted_at — prefixed
  // missed/low-eval targets have no note date and stay out of the 30d counts.
  const cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const submittedByNoteId = new Map<string, string | null>();
  for (const note of notes) submittedByNoteId.set(note.note_id, note.submitted_at ?? null);
  const annotationsSeen: ProductionPillData["annotationsSeen"] = [];
  for (const a of annotationRows) {
    const failureModes = a.failure_modes ?? [];
    for (const m of failureModes) tagCounts.set(m, (tagCounts.get(m) ?? 0) + 1);
    const submittedAt = submittedByNoteId.get(a.target_id);
    if (submittedAt && Date.parse(submittedAt) >= cutoff30d) {
      for (const m of failureModes) tagCounts30d.set(m, (tagCounts30d.get(m) ?? 0) + 1);
    }
    // target_id is a bare note_id for canonical notes (the common case); prefixed
    // missed/low-eval targets have no note tweet, so no A/B picks.
    annotationsSeen.push({ targetId: a.target_id, failureModes, seen: !!a.seen, abTestPicks: picksForNoteId(a.target_id), updatedAt: a.updated_at ?? null });
  }

  return { counts, tagCounts, tagCounts30d, notesSeen, annotationsSeen };
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
  const [{ data: capRow }, { data: hitRow }] = await Promise.all([
    supabase.from("pipeline_state").select("value").eq("key", "writing_limit").maybeSingle(),
    supabase.from("pipeline_state").select("value").eq("key", "limit_hit_at").maybeSingle(),
  ]);
  const cap = capRow?.value != null ? Number(capRow.value) : null;
  const limitHitAt = (hitRow?.value as string) ?? null;

  // Tiny columns; order by note_id (unique) so the parallel page ranges partition cleanly.
  const rows = await fetchAllRowsParallel<{ note_id: string; cn_status: string | null; submitted_at: string | null }>(
    () => supabase.from("notes").select("note_id, cn_status, submitted_at").order("note_id", { ascending: true }),
    "posting_limit_notes",
  );
  const notes = rows
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
