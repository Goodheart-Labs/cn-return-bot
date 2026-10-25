import type { Database } from "./database.types";
import {
  IMAGINED_AVERAGE_POSTS,
  IMAGINED_UNREAD_POSTS,
  LAST_POSTS_PER_CREATOR,
  MIN_SCORE_TO_WALK,
  MIN_VISITED_POSTS_TO_WALK,
} from "./readers";
import { fetchAllRows } from "./paging";
import { supabase } from "./supabase";

/* The numbers behind the admins' dashboard at /admin/dashboard. Every query
 * runs through a security-definer function, one that runs with its owner's
 * rights, because the anon key cannot read everything_events or
 * everything_votes directly. The functions return only aggregates, and anyone
 * with the public key may call them. The page itself shows only to admins. */

type RpcName = keyof Database["public"]["Functions"];

/** PostgREST caps every response at this many rows, results of a database
 *  function included. Series that grow by one row per bucket page through it. */
const PAGE_SIZE = 1000;

/** Postgres's code for a statement the server cancelled because it ran past
 *  the anon role's statement timeout, 3 seconds on this project. */
const STATEMENT_TIMEOUT_CODE = "57014";
/** The pauses before each retry of a timed-out call. The functions answer in
 *  well under a second when the database has their rows in memory. The
 *  timeout hits when the page loads with a cold cache and its calls all read
 *  from disk at once. Three retries with growing pauses outlast that on the
 *  small production instance. */
const RETRY_PAUSES_MS = [1500, 3000, 6000];

/** One page of a function's rows, retrying a statement timeout. */
async function rpcPage<T>(fn: RpcName, args: Record<string, unknown>, from: number, attempt = 0): Promise<T[]> {
  // The generated types tie each function to its own arguments, which this
  // generic pager cannot name, so the arguments go through unchecked.
  const { data, error } = await supabase.rpc(fn, args as never).range(from, from + PAGE_SIZE - 1);
  const pause = RETRY_PAUSES_MS[attempt];
  if (error?.code === STATEMENT_TIMEOUT_CODE && pause !== undefined) {
    await new Promise((resolve) => setTimeout(resolve, pause));
    return rpcPage(fn, args, from, attempt + 1);
  }
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data as T[];
}

/** Calls a function that returns rows, page by page until a short page
 *  arrives, so a series longer than PostgREST's cap still comes back whole. */
async function rpcAllRows<T>(fn: RpcName, args: Record<string, unknown>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await rpcPage<T>(fn, args, from);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

// --- The metric series behind the line chart (migrations 092 to 128) ---

export type Granularity = "day" | "week" | "month";

/** Mirrors the least(count, 20) in everything_metric_series: the slider's top
 *  step means "20 or more". */
export const HISTOGRAM_CAP = 20;

/** How many people did the thing exactly k times in the bucket, keyed by k as
 *  a string because it arrives as a jsonb object. An absent key means nobody. */
export type TimesHistogram = Record<string, number>;

export interface MetricSeriesRow {
  /** First day of the bucket, UTC, as YYYY-MM-DD. */
  bucket: string;
  /** Null means the source was not recording yet. 0 means nobody. */
  active_devices: number | null;
  note_viewers: TimesHistogram | null;
  notes_seen: number | null;
  voters: TimesHistogram | null;
  votes: number | null;
  writers: TimesHistogram | null;
  notes_written: number | null;
  installs: number | null;
  /** The installs split by browser, {"chrome": 12, "firefox": 3}. A browser
   *  with no install in the bucket is missing. */
  installs_by_browser: Record<string, number> | null;
}

/** A column that splits a count metric by browser. */
export type BrowserSplitKey = "installs_by_browser";

export type CountMetricKey = "active_devices" | "notes_seen" | "votes" | "notes_written" | "installs";
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

// --- The recently checked posts (migrations 095 to 139) ---

export interface RecentPostRow {
  id: string;
  title: string | null;
  url: string;
  project: string | null;
  /** "paragraph" when a reader asked for one highlighted passage only. */
  checked_scope: "page" | "paragraph";
  /** The day the author published the post, when the source says. */
  published_at: string | null;
  /** When the pipeline finished the post. */
  processed_at: string;
  /** The average number of different people per post, over the author's
   *  LAST_POSTS_PER_CREATOR most recently visited posts. Null when the post's
   *  project has no feed, or nobody visited the author. */
  author_visitors_per_post: number | null;
  claims_extracted: number;
  claims_checked: number;
  notes: number;
}

/** How many rows one page of a dashboard table holds. */
export const DASHBOARD_PAGE_SIZE = 25;

/** One page of the posts the pipeline finished most recently, newest first,
 *  starting after the post `after`. */
export function fetchRecentPostsPage(after: RecentPostRow | null): Promise<RecentPostRow[]> {
  return rpcPage<RecentPostRow>("everything_recent_posts", {
    last_posts: LAST_POSTS_PER_CREATOR,
    p_after_processed_at: after?.processed_at,
    p_after_id: after?.id,
    p_limit: DASHBOARD_PAGE_SIZE,
  }, 0);
}

// --- The walk's ranking of creators (migrations 131 to 139) ---

export interface CreatorRankingRow {
  feed_url: string;
  /** Null for a creator walked on visits alone who has no project yet. */
  project_slug: string | null;
  project_name: string | null;
  /** Set only while the creator's priority is open. */
  priority_until: string | null;
  /** The plain average of different people per post, without the imagined
   *  posts of creatorScore. Null for a prioritised creator nobody has visited. */
  visitors_per_post: number | null;
  score_posts: number | null;
  people: number | null;
  /** How many posts the median delay covers. Null when none qualified. */
  delay_posts: number | null;
  /** Median hours from the exact publication time to the end of the first check. */
  median_delay_hours: number | null;
  /** How many posts with notes the vote counts cover. Null when none had a
   *  visit after their first note. */
  vote_posts: number | null;
  vote_visitors: number | null;
  extension_voters: number | null;
  /** The average readers per post over all visited creators, the same in
   *  every row. The score's imagined average posts have this many readers. */
  average_readers_per_post: number;
  /** The score the walk ranks on (creatorScore). */
  walk_score: number;
}

/** One page of the creators the walk would go through if it ran now, in the
 *  walk's order, starting after the creator `after`. */
export function fetchCreatorRankingPage(after: CreatorRankingRow | null): Promise<CreatorRankingRow[]> {
  return rpcPage<CreatorRankingRow>("everything_creator_ranking_page", {
    last_posts: LAST_POSTS_PER_CREATOR,
    min_score: MIN_SCORE_TO_WALK,
    min_posts: MIN_VISITED_POSTS_TO_WALK,
    unread_posts: IMAGINED_UNREAD_POSTS,
    average_posts: IMAGINED_AVERAGE_POSTS,
    p_after_feed_url: after?.feed_url,
    p_limit: DASHBOARD_PAGE_SIZE,
  }, 0);
}

// --- The Claude note writer's plan usage (migration 140) ---

export interface ClaudeUsageRow {
  at: string;
  /** Percent of the weekly limit used. */
  weekly: number;
  /** When the weekly limit resets. Null in readings copied from logs. */
  weekly_resets_at: string | null;
}

/** Every reading of the Claude plan's usage since a time, oldest first. Only
 *  admins can read the table, through its row-level policy. */
export async function fetchClaudeUsage(since: string): Promise<ClaudeUsageRow[]> {
  const rows = await fetchAllRows<ClaudeUsageRow & { id: number }>(
    () => supabase.from("everything_claude_usage").select("id, at, weekly, weekly_resets_at").gte("at", since),
    "id",
    { label: "claude usage" },
  );
  return rows.sort((a, b) => a.id - b.id);
}
