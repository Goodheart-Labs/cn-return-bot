/**
 * Build the stats-dashboard data snapshot.
 *
 * This script reads Supabase. It joins each note to its pipeline run and to the
 * tweet it was written on, adds up the cost per A/B-pick combination, and
 * writes everything to src/stats-dashboard/public/stats-data.json.
 *
 * The dashboard is a static single-page app on GitHub Pages. It loads that JSON
 * file at runtime and does all filtering and aggregation in the browser. That is
 * why the browser never needs Supabase credentials.
 *
 * Run from repo root:
 *   bun run build-stats-data
 *   bun run build-stats-data --local      # use LOCAL_SUPABASE_*
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import dotenv from "dotenv";
import { fetchAllRows, fetchInBatches } from "../api/paging";
import { buildAbTestSlots } from "../dashboard-shared/abFilters";
import type {
  StatsSnapshot,
  NoteRecord,
  PipelineRunAggregate,
  AbOutcomeAggregate,
  PipelineRunDayBucket,
  DailyOriginCount,
} from "./src/lib/types";
import { resolvePicks } from "../pipeline/ab-testing/abTests.ts";
import { AB_TESTS } from "../pipeline/ab-testing/abTestsData.ts";

dotenv.config({ path: join(process.cwd(), ".env") });

const useLocal = process.argv.includes("--local");
const supabaseUrl = useLocal ? process.env.LOCAL_SUPABASE_URL : process.env.SUPABASE_URL;
const supabaseKey = useLocal ? process.env.LOCAL_SUPABASE_SERVICE_KEY : process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !supabaseKey) {
  throw new Error(`Missing ${useLocal ? "LOCAL_" : ""}SUPABASE_URL / SUPABASE_SERVICE_KEY`);
}
const supabase = createClient(supabaseUrl, supabaseKey);

const NOTE_COLUMNS = [
  "note_id",
  "tweet_id",
  "note_text",
  "submitted_at",
  "first_seen_at",
  "cn_status",
  "view_count",
  "rating_count",
  "helpful_count",
  "not_helpful_count",
].join(", ");

const PIPELINE_RUN_COLUMNS =
  "id, tweet_id, note_id, outcome, ab_test_picks, cost, created_at";

const TWEET_COLUMNS =
  "tweet_id, text, author_handle, media, referenced_tweet_data, has_photo, has_video, media_count";

interface RawNoteRow {
  note_id: string;
  tweet_id: string;
  note_text: string | null;
  submitted_at: string | null;
  first_seen_at: string;
  cn_status: string | null;
  view_count: number | null;
  rating_count: number | null;
  helpful_count: number | null;
  not_helpful_count: number | null;
}

interface RawPublicDumpRatingRow {
  note_id: string;
  helpful_count: number;
  somewhat_helpful_count: number;
  not_helpful_count: number;
  helpful_tag_counts: Record<string, number>;
  not_helpful_tag_counts: Record<string, number>;
  dump_date: string;
}

interface RawPipelineRunRow {
  id: string;
  tweet_id: string | null;
  note_id: string | null;
  outcome: string | null;
  ab_test_picks: Record<string, string> | null;
  cost: number | null;
  created_at: string;
}

interface RawAnnotationRow {
  id: string; // Only used as the paging cursor.
  target_id: string; // For a note annotation this is the plain note_id.
  failure_modes: string[] | null;
  seen: boolean;
}

interface RawTweetRow {
  tweet_id: string;
  text: string | null;
  author_handle: string | null;
  media: any[] | null;
  referenced_tweet_data: any | null;
  has_photo: boolean | null;
  has_video: boolean | null;
  media_count: number | null;
}

function picksKey(picks: Record<string, string> | null): string {
  if (!picks) return "{}";
  const sorted = Object.keys(picks).sort().reduce<Record<string, string>>((acc, k) => {
    acc[k] = picks[k]!;
    return acc;
  }, {});
  return JSON.stringify(sorted);
}

function buildPipelineAggregates(runs: RawPipelineRunRow[]): PipelineRunAggregate[] {
  const byKey = new Map<string, { picks: Record<string, string> | null; total_cost: number; run_count: number }>();
  for (const run of runs) {
    if (run.cost == null) continue;
    const key = picksKey(run.ab_test_picks);
    const existing = byKey.get(key);
    if (existing) {
      existing.total_cost += Number(run.cost);
      existing.run_count++;
    } else {
      byKey.set(key, {
        picks: run.ab_test_picks,
        total_cost: Number(run.cost),
        run_count: 1,
      });
    }
  }
  return [...byKey.entries()].map(([ab_test_picks_key, v]) => ({
    ab_test_picks_key,
    ab_test_picks: v.picks,
    total_cost: v.total_cost,
    run_count: v.run_count,
  }));
}

// Count run outcomes for the A/B comparison panel, one row per day and per full
// combination of picks. `total` counts every run that has finished, so the only
// runs left out are the ones still in progress. `candidate` counts every run
// whose note passed the gates, which means the candidate runs and the submitted
// ones. The rows are split by day so the panel can scope to a "last N days"
// window. The dashboard adds the days back together itself.
function buildAbOutcomeAggregates(runs: RawPipelineRunRow[]): AbOutcomeAggregate[] {
  const byKey = new Map<string, AbOutcomeAggregate>();
  for (const run of runs) {
    if (run.outcome === "in_progress") continue;
    const date = run.created_at.slice(0, 10);
    const picks = picksKey(run.ab_test_picks);
    const key = `${date}|${picks}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = { date, ab_test_picks_key: picks, ab_test_picks: run.ab_test_picks, total: 0, candidate: 0, submitted: 0, cost: 0 };
      byKey.set(key, agg);
    }
    agg.total++;
    if (run.outcome === "candidate" || run.outcome === "submitted") agg.candidate++;
    if (run.outcome === "submitted") agg.submitted++;
    agg.cost += Number(run.cost ?? 0);
  }
  return [...byKey.values()];
}

function buildPipelineRunsByDay(runs: RawPipelineRunRow[]): PipelineRunDayBucket[] {
  // Group the runs by the day they were created and by their A/B picks. The
  // dashboard uses these counts to work out how many runs in a chart bucket
  // never became a submitted note.
  const byDayKey = new Map<string, PipelineRunDayBucket>();
  for (const run of runs) {
    const date = run.created_at.slice(0, 10);
    const compositeKey = `${date}|${picksKey(run.ab_test_picks)}`;
    let bucket = byDayKey.get(compositeKey);
    if (!bucket) {
      bucket = {
        date,
        ab_test_picks: run.ab_test_picks,
        total_count: 0,
        submitted_count: 0,
      };
      byDayKey.set(compositeKey, bucket);
    }
    bucket.total_count++;
    if (run.outcome === "submitted") bucket.submitted_count++;
  }
  return [...byDayKey.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function joinNotes(
  notes: RawNoteRow[],
  runs: RawPipelineRunRow[],
  tweets: RawTweetRow[],
  publicRatings: RawPublicDumpRatingRow[],
  annotations: RawAnnotationRow[],
): NoteRecord[] {
  // Keep the most recent run for each note. We compare created_at ourselves
  // instead of trusting the order the rows arrived in. The paginator sorts by
  // primary key, not by created_at.
  const submittedRunByNoteId = new Map<string, RawPipelineRunRow>();
  for (const run of runs) {
    if (!run.note_id) continue;
    const previous = submittedRunByNoteId.get(run.note_id);
    if (!previous || run.created_at > previous.created_at) submittedRunByNoteId.set(run.note_id, run);
  }
  const tweetById = new Map<string, RawTweetRow>();
  for (const t of tweets) tweetById.set(t.tweet_id, t);
  const publicRatingByNoteId = new Map<string, RawPublicDumpRatingRow>();
  for (const r of publicRatings) publicRatingByNoteId.set(r.note_id, r);
  // For a note annotation, target_id is the plain note_id. Annotations on other
  // kinds of item carry a "missed:" or "loweval:" prefix, so they never match a
  // note_id below. An annotation with seen set to false means nobody has
  // reviewed that note yet, and we record null for it.
  const failureModesByNoteId = new Map<string, string[] | null>();
  for (const a of annotations) {
    failureModesByNoteId.set(a.target_id, a.seen ? (a.failure_modes ?? []) : null);
  }

  const records: NoteRecord[] = [];
  for (const note of notes) {
    const submittedAt = note.submitted_at;
    if (!submittedAt) continue; // Notes from before we tracked submissions.
    const run = submittedRunByNoteId.get(note.note_id);
    const tweet = tweetById.get(note.tweet_id);
    const publicRating = publicRatingByNoteId.get(note.note_id);
    records.push({
      note_id: note.note_id,
      tweet_id: note.tweet_id,
      submitted_at: submittedAt,
      cn_status: note.cn_status as NoteRecord["cn_status"],
      view_count: note.view_count ?? 0,
      helpful_count: note.helpful_count ?? 0,
      not_helpful_count: note.not_helpful_count ?? 0,
      rating_count: note.rating_count ?? 0,
      note_text: note.note_text ?? "",
      ab_test_picks: run?.ab_test_picks ?? null,
      cost: run?.cost == null ? null : Number(run.cost),
      tweet: tweet
        ? {
            text: tweet.text,
            handle: tweet.author_handle,
            media: tweet.media,
            referenced_tweet_data: tweet.referenced_tweet_data,
            has_photo: !!tweet.has_photo,
            has_video: !!tweet.has_video,
            media_count: tweet.media_count ?? 0,
          }
        : null,
      public_dump_ratings: publicRating
        ? {
            helpful_count: publicRating.helpful_count,
            somewhat_helpful_count: publicRating.somewhat_helpful_count,
            not_helpful_count: publicRating.not_helpful_count,
            helpful_tag_counts: publicRating.helpful_tag_counts ?? {},
            not_helpful_tag_counts: publicRating.not_helpful_tag_counts ?? {},
            dump_date: publicRating.dump_date,
          }
        : null,
      failure_modes: failureModesByNoteId.get(note.note_id) ?? null,
    });
  }
  records.sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
  return records;
}

async function loadAllPipelineRuns(): Promise<RawPipelineRunRow[]> {
  const rows = await fetchAllRows<RawPipelineRunRow>(
    () => supabase.from("pipeline_runs").select(PIPELINE_RUN_COLUMNS),
    "id",
    { label: "pipeline_runs" },
  );
  // Rows written before an A/B test existed carry no pick for that test. Fill in
  // the default pick here, where the rows enter the program. Doing it once means
  // the aggregates, the day buckets, the slot index and the note records all see
  // the same shape.
  for (const row of rows) {
    row.ab_test_picks = resolvePicks(row.ab_test_picks);
  }
  return rows;
}

async function loadNotes(): Promise<RawNoteRow[]> {
  return fetchAllRows<RawNoteRow>(
    () => supabase.from("notes").select(NOTE_COLUMNS).not("submitted_at", "is", null),
    "note_id",
    { label: "notes" },
  );
}

async function loadTweets(tweetIds: string[]): Promise<RawTweetRow[]> {
  return fetchInBatches<RawTweetRow>(
    (chunk) => supabase.from("tweets").select(TWEET_COLUMNS).in("tweet_id", chunk),
    tweetIds,
    { label: "tweets" },
  );
}

async function loadPublicRatings(): Promise<RawPublicDumpRatingRow[]> {
  return fetchAllRows<RawPublicDumpRatingRow>(
    () =>
      supabase
        .from("note_ratings_from_public_dump")
        .select("note_id, helpful_count, somewhat_helpful_count, not_helpful_count, helpful_tag_counts, not_helpful_tag_counts, dump_date"),
    "note_id",
    { label: "note_ratings_from_public_dump" },
  );
}

async function loadAnnotations(): Promise<RawAnnotationRow[]> {
  return fetchAllRows<RawAnnotationRow>(
    () =>
      supabase
        .from("review_dashboard_annotations")
        .select("id, target_id, failure_modes, seen")
        .eq("source", "production"),
    "id",
    { label: "review_dashboard_annotations" },
  );
}

async function loadDailyOriginCounts(): Promise<DailyOriginCount[]> {
  return fetchAllRows<DailyOriginCount>(
    () =>
      supabase
        .from("daily_note_origin_counts")
        .select("day, helpful_total, helpful_ours, helpful_other_ai"),
    "day",
    { label: "daily_note_origin_counts" },
  );
}

async function buildSnapshot(): Promise<StatsSnapshot> {
  const [notes, pipelineRuns, publicRatings, annotations, dailyOriginCounts] = await Promise.all([
    loadNotes(),
    loadAllPipelineRuns(),
    loadPublicRatings(),
    loadAnnotations(),
    loadDailyOriginCounts(),
  ]);
  const tweetIds = [...new Set(notes.map((n) => n.tweet_id).filter(Boolean))];
  const tweets = tweetIds.length ? await loadTweets(tweetIds) : [];

  const noteRecords = joinNotes(notes, pipelineRuns, tweets, publicRatings, annotations);
  const pipelineRunAggregates = buildPipelineAggregates(pipelineRuns);
  const abOutcomeAggregates = buildAbOutcomeAggregates(pipelineRuns);
  const pipelineRunsByDay = buildPipelineRunsByDay(pipelineRuns);
  const abTestSlots = buildAbTestSlots(
    pipelineRuns.map((r) => ({ picks: r.ab_test_picks, at: r.created_at })),
    AB_TESTS,
  );

  return {
    generated_at: new Date().toISOString(),
    notes: noteRecords,
    pipeline_run_aggregates: pipelineRunAggregates,
    ab_outcome_aggregates: abOutcomeAggregates,
    pipeline_runs_by_day: pipelineRunsByDay,
    ab_test_slots: abTestSlots,
    daily_note_origin_counts: dailyOriginCounts,
  };
}

async function main() {
  console.log(`[build-data] Building snapshot from ${useLocal ? "LOCAL" : "PROD"} Supabase...`);
  const snapshot = await buildSnapshot();
  const outPath = join(import.meta.dir, "public", "stats-data.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(snapshot));
  const sizeKb = (Buffer.byteLength(JSON.stringify(snapshot)) / 1024).toFixed(1);
  console.log(`[build-data] Wrote ${outPath} (${sizeKb} KB)`);
  console.log(`[build-data] notes=${snapshot.notes.length} aggregates=${snapshot.pipeline_run_aggregates.length} outcome_aggs=${snapshot.ab_outcome_aggregates.length} run_days=${snapshot.pipeline_runs_by_day.length} slots=${snapshot.ab_test_slots.length} origin_days=${snapshot.daily_note_origin_counts.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
