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

// A review item's annotation `target_id` says which kind of item it belongs to.
// That is what lets one annotations table key three different sources without
// collisions. A bare id is a `notes.note_id`, so it is one of our own notes. An
// id with the missed prefix is a `competing_notes.note_id`, so it is a note
// somebody else wrote and never one of ours. An id with the low-eval prefix is a
// `pipeline_runs.id`. Those notes were never submitted, so they have no row in
// `notes` at all. Every piece of code that builds or reads an item id must go
// through the helpers below.
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

/** Reads a target id back into the item it points at. This is the inverse of
 *  missedTargetId and lowEvalTargetId. */
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

// This is the one place that decides whether a note is "underwater". A note is
// underwater when Community Notes still calls it NEEDS_MORE_RATINGS, but it has
// collected enough ratings to score below the bar Community Notes uses to display
// a note.
// Community Notes scores each rating as Helpful = 1, Somewhat helpful = 0.5 and
// Not helpful = 0, and it publishes a note once the note's leniency-adjusted
// intercept passes 0.4. We cannot see that adjusted intercept, because computing
// it needs the full matrix of raters. So we approximate it with the plain
// weighted average of the public rating counts.
// Our threshold sits well below the 0.4 bar. Nathan tuned it by hand on
// 2026-07-14. At 0.4 the pill flagged about 575 notes, which is more than he can
// review. At 0.2 it flags about 170 notes that are clearly sinking. We tightened
// the ratio instead of raising the minimum number of ratings, because a higher
// floor would bias the pill towards notes on high-traffic posts.
// A note with fewer than UNDERWATER_MIN_RATINGS ratings stays in "Needs More
// Ratings". Such a note is genuinely undecided rather than sunk.
// The helpful and not-helpful counts are resolved the same way the card's rating
// badge resolves them. The public dump comes first, and the scraped counts are
// the fallback. The somewhat-helpful count exists only in the public dump.
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
  if (leadMs <= 0) return undefined; // We wrote first, so there is no lead to report.

  for (const { hours, label } of COMPETITOR_LEAD_THRESHOLDS) {
    if (leadMs > hours * ONE_HOUR_MS) return label;
  }
  return undefined;
}

// The columns the production list needs. Since the old
// canonical_note_information table was merged into `notes`, this table no longer
// carries the tweet text, the author handle or current_core_status. The tweet
// text now comes from the `tweets` table, joined by tweet_id. For a note's status
// we use current_status, stored here as cn_status, as CLAUDE.md instructs.
const CANONICAL_LIST_COLUMNS = CANONICAL_LIST_COLS.join(", ");

// The pipeline_runs columns for the metadata fetch that drives the list. The
// large `logs` column is left out, so Postgres never has to read it out of TOAST
// storage here. Logs are loaded later, one visible card at a time. The tweet text
// and the media flags live on the tweets table, so we fetch those separately and
// stitch the two together by tweet_id.
const PIPELINE_METADATA_COLUMNS =
  "id, tweet_id, outcome, outcome_reason, bot_name, created_at, ab_test_picks";

// A run rejected for a low evaluation score was never submitted, so it has no row
// in `notes`. Its note text and note status live on the pipeline_runs row itself,
// so we pull those columns too.
const LOW_EVAL_RUN_COLUMNS =
  "id, tweet_id, note_text, note_status, outcome, outcome_reason, bot_name, created_at, ab_test_picks";

// Notes the bot wrote but never submitted, because the daily cap was full or a
// pre-submit check failed. Their text lives on the pipeline_run and they have no
// row in `notes`, exactly like the low-evaluation-score rejections. So they
// travel the same recovery path. buildDashboardItems marks them isDraft and gives
// them the failure type filtered_no_slot or draft_check_failed.
const DRAFT_OUTCOME_REASONS = ["daily_limit_reached", "check_failed"];
// Every outcome_reason for a note that was never submitted but whose note_text we
// still show in the list. That is the low-evaluation-score rejections plus the two
// draft reasons above. A single `.in()` fetch covers all three.
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
  // The misinformation-monitoring sightings for the visible tweets, one row per
  // tweet_id and topic_id. They let an item carry its fact-check topic and the
  // review set derived from that topic.
  sightings: any[];
}

/**
 * The annotation `target_id`s for one set of primary rows. They mirror the three
 * item shapes buildDashboardItems emits. Our own notes key on their note_id.
 * Missed opportunities and low-evaluation-score rejections key on their prefixed
 * encodings.
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
 * Takes the three sets of primary rows that anchor a production view. Those are
 * our own notes, the competing notes that count as missed opportunities, and the
 * runs rejected for a low evaluation score. It fetches every satellite row needed
 * to render them, which means the comparison notes, the pipeline runs, the
 * tweets, the ratings and the annotations. It returns the bundle
 * buildDashboardItems consumes.
 *
 * Every satellite query is scoped to those primary rows and never scans the whole
 * table. That is what keeps loading fast. The old version pulled all of
 * competing_notes, about 13k rows, plus all of pipeline_runs and all of the
 * public ratings, on every page load.
 * The date-windowed loader fetchDashboardData and the tag-anchored loader
 * fetchDashboardDataByTags both go through here. The pipeline logs are the only
 * thing still fetched on demand, by fetchLogsForRuns, once a card becomes visible.
 */
async function assembleDashboardData(primary: {
  canonical: any[];
  missedOppCompeting: any[];
  lowEvalRuns: any[];
}): Promise<DashboardData> {
  const { canonical, missedOppCompeting, lowEvalRuns } = primary;
  const noteIds = canonical.map((n: any) => n.note_id);
  const noteTweetIds = [...new Set(canonical.map((n: any) => n.tweet_id).filter(Boolean))];
  // Only a competing note that still qualifies becomes a missed-opportunity item.
  // The tag-anchored path fetches them by note_id without the qualifying filters,
  // so we check them again here.
  const missedOpps = missedOppCompeting.filter(isMissedOppCompetingNote);

  // Each satellite fetch is fail-soft. On an error it falls back to an empty list
  // instead of throwing. One slow or failed enrichment query therefore cannot
  // blank the whole note list. The notes always render, just with less
  // classification and comparison detail on them.
  const softBatch = (p: Promise<any[]>, what: string) =>
    p.catch((e) => { console.warn(`[data] ${what} failed — degrading:`, e); return [] as any[]; });
  // Every id the satellites need can be derived from the primary fetch, so they
  // all run in one parallel wave. They used to be five awaits in a row, and the
  // tweet text then landed four round trips after the notes had painted (Nathan,
  // 2026-07-29). A few tweet ids turn up only on the fetched runs, which is rare.
  // Those get a small top-up fetch after the wave.
  const missedRunIds = [
    ...new Set(missedOpps.map((cn: any) => cn.pipeline_run_id as string)),
  ];
  const lowEvalRunIds = lowEvalRuns.map((r: any) => r.id);
  const knownTweetIds = [
    ...new Set([...noteTweetIds, ...lowEvalRuns.map((r: any) => r.tweet_id).filter(Boolean)]),
  ];
  const [comparisonCompeting, submittedRuns, publicDumpRatings, annotations, missedRuns, lowEvalScores, tweetsMain, sightingsMain] = await Promise.all([
    // The competing notes attached to our own notes. They drive the comparison
    // list and the lost-to-competitor classification.
    softBatch(fetchInBatches<any>(
      // We list only the columns buildDashboardItems reads. Selecting "*" pulled
      // every column, including the large text ones, for about 8k rows. That was
      // the biggest single cost of the all-notes load.
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
    // A missed opportunity points at one specific pipeline_run, so we fetch only
    // those runs.
    missedRunIds.length
      ? fetchInBatches<any>(supabase, "pipeline_runs", PIPELINE_METADATA_COLUMNS, "id", missedRunIds, undefined, "missed_runs")
      : Promise.resolve([] as any[]),
    // The evaluation score lives in pipeline_scores and is not copied onto
    // pipeline_runs. We fetch it for the low-evaluation-score runs so their cards
    // can show it.
    lowEvalRunIds.length
      ? fetchInBatches<any>(
          supabase, "pipeline_scores", "pipeline_run_id, score_value", "pipeline_run_id", lowEvalRunIds,
          (q) => q.eq("score_type", "evaluation"), "low_eval_scores",
        )
      : Promise.resolve([] as any[]),
    // The tweets table holds the text, the media and the engagement numbers that
    // fill the tweet box on each note card.
    knownTweetIds.length
      ? softBatch(fetchInBatches<any>(supabase, "tweets", TWEETS_LIST_COLUMNS, "tweet_id", knownTweetIds, undefined, "tweets"), "tweets")
      : Promise.resolve([] as any[]),
    // The misinformation-monitoring sightings for these tweets. They give each
    // item its fact-check topic.
    knownTweetIds.length
      ? fetchInBatches<any>(supabase, "misinfo_monitoring_sightings", "tweet_id, topic_id", "tweet_id", knownTweetIds, undefined, "misinfo_sightings").catch(() => [] as any[])
      : Promise.resolve([] as any[]),
  ]);

  const competing = [...comparisonCompeting, ...missedOppCompeting];

  // Top up the tweets with the ids that appear only on the fetched runs and on no
  // note.
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
 * Loads every production item whose note was submitted at or after `sinceIso`. It
 * also loads the missed opportunities and the low-evaluation-score rejections
 * that fall in the same window. The window is anchored on `notes.submitted_at`,
 * which is never null in that table. Keeping the window small is what makes the
 * first paint fast. A three-day window touches a few hundred rows per table
 * instead of the whole history.
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
    // Missed opportunities are helpful competitor notes on tweets we rejected. We
    // window them on the competitor note's creation time, as a stand-in for the
    // item's own date, which is really the pipeline_run's created_at. So a recent
    // rejection of an older competitor note can fall outside the window. That is
    // acceptable for this secondary item type.
    // We select narrow columns, because a select-* scan here can exceed the
    // database statement timeout while the initial load's other queries run
    // alongside it. The fetch is also fail-soft. A missing secondary item type
    // should degrade the view, not reject the whole load.
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
    // Notes that were written but never submitted. That is the
    // low-evaluation-score rejections plus the drafts, where the daily cap was
    // full or a pre-submit check failed. They have no row in `notes`, so their
    // text comes from the run. We window them on the run's own created_at.
    // buildDashboardItems splits them apart again by outcome_reason.
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
 * Loads every note whose cn_status is one of `cnStatuses`, with no date window at
 * all. Those statuses are the ones a production view has switched on by default,
 * which today is just CURRENTLY_RATED_NOT_HELPFUL. The reviewer's standard
 * selection is therefore always complete and never needs a "load more".
 * It reuses assembleDashboardData, so these notes carry the ab_test_picks of
 * their submitted run, which makes the A/B list filter work outside the window.
 * They also carry the competing-note data, which drives the lost-to-competitor
 * reclassification. The set is small, a few hundred rows and less than one page,
 * so `limit` is only a safety cap. Missed opportunities and
 * low-evaluation-score rejections are not part of the default set, so their
 * primary row sets are empty here.
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
 * Loads every note, in every status, with no date window. The reviewer then sees
 * the whole picture, about 6k notes. That includes the roughly 85% of freshly
 * submitted NEEDS_MORE_RATINGS notes that the status-default view hides. It also
 * makes the topic and status filters authoritative, so "none of a thing" really
 * means zero. The set is small enough to load in one pass. assembleDashboardData
 * batches the satellite fetches, so no single query exceeds the database
 * statement timeout, which is how the old windowed load used to fail.
 */
export async function fetchAllNotesCanonical(): Promise<any[]> {
  console.log("[data] Loading ALL notes (canonical, every status, no window)…");
  // PostgREST caps every response at 1000 rows, so a single select would silently
  // truncate the result. We page it in parallel with fetchAllRowsParallel, which
  // keeps 8 `.range()` requests in flight. That fetches all ~6k rows in about two
  // seconds. Serial offset paging re-sorts on every page and took about ten.
  // The stable ORDER BY note_id makes the concurrent page ranges partition the
  // same ordered set cleanly. The client re-sorts by date in sortedItems.
  return fetchAllRowsParallel<any>(
    () => supabase.from("notes").select(CANONICAL_LIST_COLUMNS).order("note_id", { ascending: true }),
    "all_notes_canonical",
  );
}

/**
 * The data for the first render phase. It takes the note rows the caller has
 * already loaded and adds every production annotation, in one fast query. The
 * list can then paint in about two to three seconds, with the note text, the
 * status and the correct seen state all working. The heavy per-note satellites,
 * which are the tweets, the competing notes, the ratings and the sightings, load
 * afterwards in the background through assembleAllNotes. Fetching every satellite
 * for all ~6k notes up front took about 30 seconds.
 */
export async function fetchAllNotesPhase1(canonical: any[]): Promise<DashboardData> {
  // We fetch all production annotations in one request. The table is small, a few
  // hundred rows, so this is far faster than batching by note_id.
  // buildDashboardItems matches each annotation to its item by target_id.
  const annotations = await fetchAllRows<any>(
    supabase.from("review_dashboard_annotations").select("*").eq("source", "production"),
    "phase1_annotations",
  ).catch(() => [] as any[]);
  return { canonical, competing: [], submittedRuns: [], missedRuns: [], lowEvalRuns: [], lowEvalScores: [], annotations, tweets: [], publicDumpRatings: [], sightings: [] };
}

/** The second render phase. It attaches every satellite row to the notes. The
 *  fetches are batched and fail-soft. */
export async function assembleAllNotes(canonical: any[]): Promise<DashboardData> {
  return assembleDashboardData({ canonical, missedOppCompeting: [], lowEvalRuns: [] });
}

/**
 * Loads every production item that has ever been tagged with one of `tags`,
 * ignoring the date window. It is cheap because it starts from the small
 * annotations table, which holds one row per reviewed item, and then pulls only
 * the satellite rows for those specific targets. This is what lets the
 * failure-mode pills filter across all time rather than the loaded window alone.
 * `overlaps` means OR, which matches the pill filter on the client. An item
 * matches when it carries any of the selected tags.
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
 * Loads every production item that has ever been starred as high value, ignoring
 * the date window. It has the same shape as fetchDashboardDataByTags. It starts
 * from the small annotations table, filtered on `high_value = true`, and pulls
 * only the satellite rows for those targets. The "High-value notes" filter
 * therefore spans all time rather than the loaded window. That matters because a
 * starred note can have any status and any age, not only the ones in the fully
 * loaded rated set.
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
 * Fetches the full `logs` JSON for a set of pipeline_run ids. The interface calls
 * this when a card becomes visible. That way we only pay the cost of reading
 * those large values out of TOAST storage for the rows the user actually looks
 * at, rather than for every note we have ever written.
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
 * Builds the ReviewItems out of the raw rows one of the loaders above fetched.
 * This is a pure function and does no input or output of its own. An item carries
 * a `pipelineRunId` rather than its `logs`. The caller fills in `logs` later with
 * fetchLogsForRuns.
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
    // Split the never-submitted runs by their reason. A run that hit the daily cap
    // produced a good note that simply lost its slot. A run that failed a
    // pre-submit check is a different case. Both render as drafts. A run rejected
    // for a low evaluation score keeps its own category.
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

  // Attach each item's fact-check topic and the review set derived from it. One
  // pass covers items from every source. A regular note has no sighting, so its
  // topic stays undefined. A bundle built without the `sightings` field falls back
  // to an empty list here instead of crashing.
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
// How many page requests fetchAllRowsParallel keeps in flight at once. It lives
// here rather than in the shared helpers, because the shared serial fetchAllRows
// covers every other caller. This dashboard has only the one genuinely
// multi-page scan below.
const PILL_CONCURRENCY = 8;

/**
 * Pages through a table with several requests in flight at once. The all-time
 * notes scan is the bottleneck of the once-per-session pill-count load, and this
 * is what makes it fast. `makeQuery` must return a fresh query on every call,
 * because concurrent `.range()` calls cannot share one builder. That query also
 * needs a stable ORDER BY, so the page ranges partition the same ordered set.
 * This is only worth doing for a table that spans several pages. The other count
 * scans fit in a single page and stay on the serial fetchAllRows.
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
  // The all-time count for every category pill in the filter bar.
  counts: Record<FailureType, number>;
  // The all-time usage count for every failure-mode pill.
  tagCounts: Map<string, number>;
  // Tag usage over the notes submitted in the last 30 days. It sorts the
  // failure-mode selector on each card, so the order tracks the failure patterns
  // we are seeing now.
  tagCounts30d: Map<string, number>;
  // One entry per note, over all time. The interface uses these to recompute the
  // rated pills under the seen filter and the A/B filter, so a pill can say how
  // many are left to review in this variant instead of the all-time total. The
  // noteId is there so the interface can override an entry with the live state of
  // a note it has already loaded.
  notesSeen: { noteId: string; failureType: FailureType; seen: boolean; abTestPicks: AbPicks; submittedAt: string | null }[];
  // The same thing for the tag pills, with one entry per annotation. updatedAt is
  // when the seen flag was last toggled, and it feeds the burndown bar's estimate
  // of the recent review pace.
  annotationsSeen: { targetId: string; failureModes: string[]; seen: boolean; abTestPicks: AbPicks; updatedAt: string | null }[];
}

/**
 * Fetches everything behind the filter-bar pills in one pass, over all time. It
 * is deliberately not windowed. The list shows the last few days, but the pills
 * report the full picture, so "Rated Helpful 475" does not shrink to whatever
 * happens to be loaded. Every note and every annotation carries its `seen` flag,
 * so the interface can render seen-aware counts without fetching again. It stays
 * cheap because it selects only the small columns needed to classify a note, with
 * no text and nothing that lives in TOAST storage. Classification goes through
 * `cnStatusToFailureType`, the same function buildDashboardItems uses.
 */
export async function fetchProductionPillData(): Promise<ProductionPillData> {
  const [notes, publicRatings, helpfulCompeting, missed, lowEval, noSlot, checkFailed, annotationRows, abRuns] = await Promise.all([
    // The notes scan is the bottleneck of this once-per-session load, at about
    // four pages, so we page it in parallel. The other scans fit in one page and
    // stay serial. The stable ORDER BY note_id makes the concurrent page ranges
    // partition cleanly. The helpful and not-helpful counts feed the underwater
    // classification.
    fetchAllRowsParallel<any>(
      () => supabase.from("notes").select("note_id, cn_status, tweet_id, helpful_count, not_helpful_count, submitted_at").order("note_id", { ascending: true }),
      "count_notes",
    ),
    // The public-dump rating counts for every note. The underwater pill count then
    // resolves its counts the same public-dump-first way the loaded cards do. We
    // select only the count columns and leave out the tag JSON, which keeps the
    // scan cheap.
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
    // This count is estimated rather than exact. An exact count is an unindexed
    // scan over all of pipeline_runs and reliably exceeds the database statement
    // timeout, and the pill then silently shows 0. The planner's estimate is close
    // enough for a pill.
    supabase
      .from("pipeline_runs")
      .select("id", { count: "estimated", head: true })
      .eq("outcome_reason", "low_evaluation_score"),
    // Estimated counts for the two draft pills. The first counts the runs that hit
    // the daily cap, the second the runs that failed a pre-submit check.
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
    // The A/B picks per note, so the pill counts can respect the A/B filter. They
    // are keyed by tweet_id off the submitted run, the same way buildDashboardItems
    // keys them. We fetch only the runs that carry picks, which keeps the result
    // small. A note without picks simply never matches an A/B filter.
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
  // A 30-day window drives the sort order of the tag selector on each card. Tags
  // on notes submitted in the last month track what is going wrong now, so a
  // retired failure mode sinks down the list (Nathan, 2026-07-28). The window keys
  // on the note's submitted_at. The prefixed missed-opportunity and
  // low-evaluation-score targets have no note date, so they stay out of the 30-day
  // counts.
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
    // For one of our own notes, which is the common case, target_id is a bare
    // note_id. The prefixed missed-opportunity and low-evaluation-score targets
    // have no note of ours and therefore no tweet, so they have no A/B picks.
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
    // The annotations table may not exist yet, so we carry on without them.
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
  // This is one atomic upsert, keyed on the pair (source, target_id). Only the
  // fields present in `update` are written. The rest fall back to their column
  // defaults on a first insert, and are left untouched when the upsert merges into
  // an existing row.
  // It replaced an older sequence that selected first and then inserted or
  // updated. That sequence could throw without anyone noticing. A duplicate row
  // made `.single()` fail, and the fresh insert that followed then hit the unique
  // constraint. The user saw a star click that did nothing at all.
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

  // Adding a tag that was marked as fixed unmarks it. Typing the name into the
  // picker is a clear signal that the user wants the tag back in active use.
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
// ─── Posting limit ───────────────────────────────────────────────────────────

// This is the data behind the dashboard's "Posting limit" drawer. X caps how many
// notes we may write per day. We only ever learn that cap by observation. X
// answers a submission with a 403 saying we hit the daily limit, and we record
// the count at that moment.
// The code below rebuilds X's published formula for AI writers from our live note
// statuses, so we can see which input the cap is currently resting on. The
// formula comes from X's "writing-notes" guide and its AI-writer page. Its
// denominator counts unrated notes as well. We confirmed that in X's own scoring
// code, in communitynotes/scoring/.../contributor_state.py.

const H_STATUS = "CURRENTLY_RATED_HELPFUL";
const NH_STATUS = "CURRENTLY_RATED_NOT_HELPFUL";

export interface CapWindow {
  key: string; // One of HR_R, HR_100 or HR_14d.
  label: string;
  rate: number; // The net hit rate. It is helpful minus not-helpful, over denom.
  h: number;
  nh: number;
  nmr: number; // How many notes written in this window are still unrated.
  denom: number;
  binding: boolean; // True when this is the window currently setting WL_L.
}

export interface CapTier {
  label: string;
  formula: string;
  active: boolean;
}

export interface PostingLimitData {
  // The writing_limit we actually observed, read from pipeline_state. This is the
  // real ceiling.
  cap: number | null;
  limitHitAt: string | null;
  modeledCap: number; // The write limit WL the formula gives for the live inputs.
  wlL: number; // The quality ceiling WL_L.
  dn30: number;
  volTerm: number; // The volume term. It is DN_30 multiplied by 5.
  bindingTerm: "quality" | "volume" | "cliff";
  hrL: number; // The larger of HR_100 and HR_14d.
  windows: CapWindow[];
  tiers: CapTier[];
  nh5: number;
  nh10: number;
  bindingWindow: CapWindow | null;
  // How far the cap moves when the binding window's rate rises by one percentage
  // point.
  slopePerPoint: number;
  // The share of all the notes we have ever written that carry a rating.
  ratedAtAll: number;
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

  // We select only tiny columns. note_id is unique, so ordering by it makes the
  // parallel page ranges partition cleanly.
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
  // The denominator is every note written in the window, not only the rated ones.
  // X's own scoring counts unrated notes in totalNotes, and counting all written
  // notes is the only variant that has reproduced the cap we observe. Counting
  // only the rated ones inflated the rate about six times (Nathan, 2026-08-05:
  // "laughably wrong").
  const hr14d = in14.length ? (c14.h - c14.nh) / in14.length : 0;
  const dn30 = in30.length / 30;

  const ratedRev = notes.filter((n) => isH(n.cn_status) || isNH(n.cn_status)).reverse();
  const nh5 = ratedRev.slice(0, 5).filter((n) => isNH(n.cn_status)).length;
  const nh10 = ratedRev.slice(0, 10).filter((n) => isNH(n.cn_status)).length;

  const t = notes.length;
  const cur = computeWL({ hr100, hr14d, hrR, dn30, nh5, nh10, t });
  const hrL = Math.max(hr100, hr14d);

  // Work out which window is carrying WL_L. Below 5% the last-20 window counts
  // too, because the formula takes the largest of the windows.
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
