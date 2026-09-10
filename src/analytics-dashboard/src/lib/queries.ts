import { supabase } from "../../../everything-shared/supabase";
import { MIN_PAGES_FOR_A_REGULAR_READER } from "../../../everything-shared/readers";
import { noteStatus } from "../../../everything-shared/noteScore";

// Every query runs through a security-definer RPC (migrations 077, 080, 089
// and 092). The anon key cannot read everything_events or everything_votes
// directly, and the RPCs return only aggregates.

/** PostgREST caps every response at this many rows, RPC results included.
 *  Series that grow one row per bucket page through it. */
const PAGE_SIZE = 1000;

/** Postgres's code for a statement the server cancelled because it ran past
 *  the anon role's statement timeout, 3 seconds on this project. */
const STATEMENT_TIMEOUT_CODE = "57014";
const RETRY_AFTER_TIMEOUT_MS = 1500;

/** One page of an RPC's rows. A statement timeout is retried once: the
 *  functions answer in well under a second warm, and the timeout only hits
 *  on a cold cache or a saturated disk, which the retry usually outlasts. */
async function rpcPage<T>(fn: string, args: Record<string, unknown>, from: number, retry = true): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, args).range(from, from + PAGE_SIZE - 1);
  if (error?.code === STATEMENT_TIMEOUT_CODE && retry) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_TIMEOUT_MS));
    return rpcPage(fn, args, from, false);
  }
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data as T[];
}

/** Calls a set-returning RPC page by page until a short page arrives, so a
 *  series longer than PostgREST's cap still comes back whole. */
async function rpcAllRows<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await rpcPage<T>(fn, args, from);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export type FunnelStage =
  | "visitors"
  | "devices"
  | "shown_notes"
  | "signed_in"
  | "voted_1"
  | "voted_5"
  | "voted_10";

export interface FunnelRow {
  platform: string;
  stage: FunnelStage;
  users: number;
}

export interface TimeWindow {
  label: string;
  days: number | null;
}

export const WINDOWS: readonly TimeWindow[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "All time", days: null },
];

export async function fetchFunnel(days: number | null): Promise<FunnelRow[]> {
  const { data, error } = await supabase.rpc("everything_funnel", { window_days: days });
  if (error) throw new Error(`everything_funnel failed: ${error.message}`);
  return data as FunnelRow[];
}

export interface CreatorRow {
  creator: string;
  visits: number;
  /** How many different readers opened anything of this creator's inside the
   *  window. A reader is one browser, recognised by the reader hash on the
   *  visit row (GOO-135). */
  readers: number;
  /** How many of those readers opened at least MIN_PAGES_FOR_A_REGULAR_READER
   *  different pages. This is the number the pipeline ranks creators by. */
  regular_readers: number;
  /** Pipeline totals for the creator's project, unwindowed. All zero when the
   *  visits could not be attributed to a project. */
  processed: number;
  notes: number;
  errored: number;
}

export async function fetchCreators(days: number | null): Promise<CreatorRow[]> {
  const { data, error } = await supabase.rpc("everything_creator_visits", {
    window_days: days,
    min_pages: MIN_PAGES_FOR_A_REGULAR_READER,
  });
  if (error) throw new Error(`everything_creator_visits failed: ${error.message}`);
  return data as CreatorRow[];
}

// --- The metric series behind the line graph (migration 092) ---

export type Granularity = "day" | "week" | "month";

/** Mirrors the least(count, 20) in everything_metric_series: the slider's top
 *  step means "20 or more". */
export const HISTOGRAM_CAP = 20;

/** How many people did the thing exactly k times in the bucket, keyed by k as
 *  a string because it arrives as a jsonb object. Sparse: an absent key means
 *  nobody. */
export type TimesHistogram = Record<string, number>;

export interface MetricSeriesRow {
  /** First day of the bucket, UTC, as YYYY-MM-DD. */
  bucket: string;
  /** Null means the source was not recording yet; 0 means nobody. */
  active_devices: number | null;
  note_viewers: TimesHistogram | null;
  notes_seen: number | null;
  voters: TimesHistogram | null;
  votes: number | null;
  writers: TimesHistogram | null;
  notes_written: number | null;
}

export type CountMetricKey = "active_devices" | "notes_seen" | "votes" | "notes_written";
export type HistogramMetricKey = "note_viewers" | "voters" | "writers";

/** People who did the thing at least `times` times. Null passes through, so a
 *  bucket before the source began recording stays a gap in the line. */
export function peopleAtLeast(histogram: TimesHistogram | null, times: number): number | null {
  if (histogram === null) return null;
  return Object.entries(histogram)
    .filter(([k]) => Number(k) >= times)
    .reduce((sum, [, people]) => sum + people, 0);
}

export function fetchMetricSeries(granularity: Granularity): Promise<MetricSeriesRow[]> {
  return rpcAllRows<MetricSeriesRow>("everything_metric_series", { granularity });
}

// --- The pipeline funnel (migration 092) ---

/** One vote tally shared by `notes` AI notes written on the day's posts. */
export interface NoteTally {
  helpful_count: number;
  somewhat_helpful_count: number;
  not_helpful_count: number;
  notes: number;
}

export interface PipelineDayRow {
  /** UTC day as YYYY-MM-DD, the day the pipeline finished the posts. */
  day: string;
  items_processed: number;
  claims_extracted: number;
  claims_checked: number;
  ai_note_tallies: NoteTally[];
}

export function fetchPipelineDays(): Promise<PipelineDayRow[]> {
  return rpcAllRows<PipelineDayRow>("everything_pipeline_daily", {});
}

export interface PipelineFunnelBars {
  items_processed: number;
  claims_extracted: number;
  claims_checked: number;
  ai_notes: number;
  /** AI notes whose tally noteStatus() calls helpful. The rule lives in
   *  everything-shared/noteScore.ts, not in SQL, so it is applied here. */
  ai_notes_helpful: number;
}

const isRatedHelpful = (tally: NoteTally) => noteStatus({ ...tally, author_id: null }) === "helpful";

/** The funnel for a range of days: every count summed, and the helpful bar
 *  summed over the tallies the shared rating rule accepts. */
export function pipelineFunnelBars(days: PipelineDayRow[]): PipelineFunnelBars {
  const bars: PipelineFunnelBars = { items_processed: 0, claims_extracted: 0, claims_checked: 0, ai_notes: 0, ai_notes_helpful: 0 };
  for (const day of days) {
    bars.items_processed += day.items_processed;
    bars.claims_extracted += day.claims_extracted;
    bars.claims_checked += day.claims_checked;
    for (const tally of day.ai_note_tallies) {
      bars.ai_notes += tally.notes;
      if (isRatedHelpful(tally)) bars.ai_notes_helpful += tally.notes;
    }
  }
  return bars;
}
