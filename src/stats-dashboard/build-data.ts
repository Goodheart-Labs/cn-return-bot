/**
 * Build the stats-dashboard data snapshot.
 *
 * Queries Supabase, joins notes ↔ pipeline_runs ↔ tweets, aggregates costs
 * per A/B-pick combination, and writes the result to
 * src/stats-dashboard/public/stats-data.json.
 *
 * The dashboard is a static SPA on GitHub Pages. It loads this JSON file at
 * runtime and does all filtering / aggregation client-side. We never expose
 * Supabase credentials to the browser.
 *
 * Run from repo root:
 *   bun run build-stats-data
 *   bun run build-stats-data --local      # use LOCAL_SUPABASE_*
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import dotenv from "dotenv";
import {
  fetchAllRows,
  fetchInBatches,
} from "../dashboard-shared/supabasePaging";
import type {
  StatsSnapshot,
  NoteRecord,
  PipelineRunAggregate,
  PipelineRunDayBucket,
  ABTestSlotInfo,
} from "./src/lib/types";
import { AB_TESTS } from "../pipeline/utils/abTests";

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
  "source_url",
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
  source_url: string | null;
  submitted_at: string | null;
  first_seen_at: string;
  cn_status: string | null;
  view_count: number | null;
  rating_count: number | null;
  helpful_count: number | null;
  not_helpful_count: number | null;
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

function buildPipelineRunsByDay(runs: RawPipelineRunRow[]): PipelineRunDayBucket[] {
  // Group by (YYYY-MM-DD from created_at, ab_test_picks). Used by the
  // dashboard to compute non-candidate counts per chart bucket.
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

// Index slots and their variants by their position in AB_TESTS so the
// dashboard renders the filter panel in declaration order. Slots or
// variants that exist in historical pipeline_runs but no longer in
// AB_TESTS (e.g., a deleted test) get appended after the known ones,
// alphabetically.
const AB_TEST_SLOT_INDEX = new Map(AB_TESTS.map((t, i) => [t.name, i]));
const AB_TEST_VARIANT_INDEX = new Map(
  AB_TESTS.map((t) => [t.name, new Map(t.variants.map((v, i) => [v.variant.name, i]))]),
);

function compareByMaybeIndex(
  a: string,
  b: string,
  index: Map<string, number>,
): number {
  const ai = index.get(a);
  const bi = index.get(b);
  if (ai != null && bi != null) return ai - bi;
  if (ai != null) return -1;
  if (bi != null) return 1;
  return a.localeCompare(b);
}

function buildAbTestSlots(runs: RawPipelineRunRow[]): ABTestSlotInfo[] {
  const variantsBySlot = new Map<string, Set<string>>();
  for (const run of runs) {
    const picks = run.ab_test_picks;
    if (!picks) continue;
    for (const [slot, variant] of Object.entries(picks)) {
      if (!variantsBySlot.has(slot)) variantsBySlot.set(slot, new Set());
      variantsBySlot.get(slot)!.add(variant);
    }
  }
  return [...variantsBySlot.entries()]
    .map(([name, variants]) => {
      const variantIndex = AB_TEST_VARIANT_INDEX.get(name) ?? new Map<string, number>();
      const ordered = [...variants].sort((a, b) => compareByMaybeIndex(a, b, variantIndex));
      return { name, variants: ordered };
    })
    .sort((a, b) => compareByMaybeIndex(a.name, b.name, AB_TEST_SLOT_INDEX));
}

function joinNotes(
  notes: RawNoteRow[],
  runs: RawPipelineRunRow[],
  tweets: RawTweetRow[],
): NoteRecord[] {
  const submittedRunByNoteId = new Map<string, RawPipelineRunRow>();
  for (const run of runs) {
    if (run.note_id) submittedRunByNoteId.set(run.note_id, run);
  }
  const tweetById = new Map<string, RawTweetRow>();
  for (const t of tweets) tweetById.set(t.tweet_id, t);

  const records: NoteRecord[] = [];
  for (const note of notes) {
    const submittedAt = note.submitted_at;
    if (!submittedAt) continue; // pre-tracking rows: skip from stats dashboard
    const run = submittedRunByNoteId.get(note.note_id);
    const tweet = tweetById.get(note.tweet_id);
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
      source_url: note.source_url,
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
    });
  }
  records.sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
  return records;
}

async function loadAllPipelineRuns(): Promise<RawPipelineRunRow[]> {
  return fetchAllRows<RawPipelineRunRow>(
    supabase
      .from("pipeline_runs")
      .select(PIPELINE_RUN_COLUMNS)
      .order("created_at", { ascending: true }),
    "pipeline_runs",
  );
}

async function loadNotes(): Promise<RawNoteRow[]> {
  return fetchAllRows<RawNoteRow>(
    supabase
      .from("notes")
      .select(NOTE_COLUMNS)
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: true }),
    "notes",
  );
}

async function loadTweets(tweetIds: string[]): Promise<RawTweetRow[]> {
  return fetchInBatches<RawTweetRow>(
    supabase,
    "tweets",
    TWEET_COLUMNS,
    "tweet_id",
    tweetIds,
    undefined,
    "tweets",
  );
}

async function buildSnapshot(): Promise<StatsSnapshot> {
  const [notes, pipelineRuns] = await Promise.all([loadNotes(), loadAllPipelineRuns()]);
  const tweetIds = [...new Set(notes.map((n) => n.tweet_id).filter(Boolean))];
  const tweets = tweetIds.length ? await loadTweets(tweetIds) : [];

  const noteRecords = joinNotes(notes, pipelineRuns, tweets);
  const pipelineRunAggregates = buildPipelineAggregates(pipelineRuns);
  const pipelineRunsByDay = buildPipelineRunsByDay(pipelineRuns);
  const abTestSlots = buildAbTestSlots(pipelineRuns);

  return {
    generated_at: new Date().toISOString(),
    notes: noteRecords,
    pipeline_run_aggregates: pipelineRunAggregates,
    pipeline_runs_by_day: pipelineRunsByDay,
    ab_test_slots: abTestSlots,
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
  console.log(`[build-data] notes=${snapshot.notes.length} aggregates=${snapshot.pipeline_run_aggregates.length} run_days=${snapshot.pipeline_runs_by_day.length} slots=${snapshot.ab_test_slots.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
