/** The database reads and writes of cn-x-watch (GOO-851). Every query reads
 *  only the rows of this process's X account (src/api/xAccount.ts). A failed
 *  query throws, and main.ts counts that tick as failed. */

import { getSupabaseClient, type SupabaseLogger } from "../api/supabaseClient";
import { currentXAccount } from "../api/xAccount";
import type { WrittenNote } from "../api/fetchNotesWritten";
import { fetchAllRows, fetchInBatches } from "../everything-core/paging";
import type { FeedReading, ViewReading } from "../pipeline/utils/viewsToCome";
import { SCORE_HISTORY_DAYS, type ScoreHistory } from "../pipeline/utils/viewsThreshold";
import { NEW_WRITER_DAILY_LIMIT, type WriterState } from "./room";

/** What a test-mode note's run says instead of a note id. Test notes are not
 *  public, so they get no row in `notes`. */
export const TEST_MODE_REASON = "test_mode";
const QUEUED_REASON = "queued";
const SUBMISSION_WINDOW_HOURS = 24;
/** The note rate comes from this many of the account's last finished posts. */
const RUNS_FOR_NOTE_RATE = 100;
/** The rows are narrow, so a walk of about 700 posts is one request. */
const VIEWS_WRITE_CHUNK = 1000;

const runs = () => getSupabaseClient().from("pipeline_runs");

/** The account's own keys in pipeline_state, such as `wsdm:writing_limit`. */
export const stateKey = (name: "admitted_at" | "writing_limit" | "limit_hit_at" | "test_note_allowance" | "test_notes_announced") => `${currentXAccount()}:${name}`;

async function count(query: PromiseLike<{ count: number | null; error: { message: string } | null }>, label: string): Promise<number> {
  const { count: rows, error } = await query;
  if (error) throw new Error(`Could not count ${label}: ${error.message}`);
  return rows ?? 0;
}

/** The given feed posts that this account already gave a run, whatever came of it. */
export async function handledTweetIds(tweetIds: string[]): Promise<Set<string>> {
  const rows = await fetchInBatches<{ id: string; tweet_id: string }>(
    (chunk) => runs().select("id, tweet_id").eq("x_account", currentXAccount()).in("tweet_id", chunk),
    tweetIds,
    "id",
    { label: "x-watch.handled" },
  );
  return new Set(rows.map((row) => row.tweet_id));
}

/** Posts that wait for a Claude, and notes that wait to be submitted. */
export function countOpenNotes(): Promise<number> {
  return count(
    runs().select("id", { count: "exact", head: true })
      .eq("x_account", currentXAccount())
      .or(`outcome.eq.in_progress,and(outcome.eq.candidate,outcome_reason.eq.${QUEUED_REASON})`),
    "open notes",
  );
}

export async function readWriterState(logger: SupabaseLogger): Promise<WriterState> {
  if (!(await logger.getPipelineState(stateKey("admitted_at")))) {
    const testNotesSubmitted = await count(
      runs().select("id", { count: "exact", head: true }).eq("x_account", currentXAccount()).eq("outcome_reason", TEST_MODE_REASON),
      "test notes",
    );
    const allowance = await logger.getPipelineState(stateKey("test_note_allowance"));
    return { kind: "testing", testNotesSubmitted, testNoteAllowance: allowance === null ? 0 : Number(allowance) };
  }
  const storedLimit = await logger.getPipelineState(stateKey("writing_limit"));
  const limitHitAt = await logger.getPipelineState(stateKey("limit_hit_at"));
  return {
    kind: "admitted",
    writingLimit: storedLimit === null ? NEW_WRITER_DAILY_LIMIT : Number(storedLimit),
    submittedLast24h: await logger.countRecentSubmissions(SUBMISSION_WINDOW_HOURS),
    limitHitAt: limitHitAt === null ? null : new Date(limitHitAt),
  };
}

export type QueuedNote = { runId: string; tweetId: string; noteText: string; sourceUrl: string };

/** The account's notes that Claude wrote and that wait to be submitted, oldest first. */
export async function queuedNotes(): Promise<QueuedNote[]> {
  const { data, error } = await runs()
    .select("id, tweet_id, note_text, source_url")
    .eq("x_account", currentXAccount())
    .eq("outcome", "candidate")
    .eq("outcome_reason", QUEUED_REASON)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read the queued notes: ${error.message}`);
  return data.map((row) => ({ runId: row.id, tweetId: row.tweet_id, noteText: row.note_text ?? "", sourceUrl: row.source_url ?? "" }));
}

/** Stores the status X gives each of the account's public notes, such as
 *  CURRENTLY_RATED_HELPFUL, in the uppercase form the rest of the system uses.
 *  The feedback job does this for the first account only. A row is written
 *  only when its status changed. */
export async function storeNoteStatuses(written: WrittenNote[]): Promise<number> {
  const stored = await fetchAllRows<{ note_id: string; cn_status: string | null }>(
    () => getSupabaseClient().from("notes").select("note_id, cn_status").eq("x_account", currentXAccount()),
    "note_id",
    { label: "x-watch.noteStatuses" },
  );
  const storedStatus = new Map(stored.map((row) => [row.note_id, row.cn_status]));
  const changed = written.filter((note) => note.status && storedStatus.has(note.id) && storedStatus.get(note.id) !== note.status.toUpperCase());
  for (const note of changed) {
    const { error } = await getSupabaseClient().from("notes").update({ cn_status: note.status!.toUpperCase() }).eq("note_id", note.id);
    if (error) throw new Error(`Could not store the status of note ${note.id}: ${error.message}`);
  }
  return changed.length;
}

export async function markTestNoteSubmitted(runId: string): Promise<void> {
  const { error } = await runs().update({ outcome: "submitted", outcome_reason: TEST_MODE_REASON, final_stage: "submission" }).eq("id", runId);
  if (error) throw new Error(`Could not mark run ${runId} as a submitted test note: ${error.message}`);
}

/** One read of the whole feed. walkedAt is when it started, and every post
 *  is in it once, in X's order. */
export type FeedWalk = { walkedAt: Date; readings: FeedReading[] };

/** Stores one reading of each post of the walk with its score (migration 203). */
export async function saveFeedWalk(walk: FeedWalk, viewsToCome: Map<string, number | null>): Promise<void> {
  const rows = walk.readings.map(({ post, observedAt }, i) => ({
    x_account: currentXAccount(),
    walked_at: walk.walkedAt.toISOString(),
    tweet_id: post.id,
    observed_at: observedAt.toISOString(),
    impressions: post.public_metrics?.impression_count ?? null,
    feed_rank: i + 1,
    views_to_come: viewsToCome.get(post.id) ?? null,
  }));
  for (let i = 0; i < rows.length; i += VIEWS_WRITE_CHUNK) {
    const { error } = await getSupabaseClient().from("x_watch_feed_views").insert(rows.slice(i, i + VIEWS_WRITE_CHUNK));
    if (error) throw new Error(`Could not store the feed readings: ${error.message}`);
  }
}

/** The readings of the account's newest stored walk that started between
 *  `from` and `to`, for the first walk after a restart. Empty when there is
 *  none. */
export async function storedReadings(from: Date, to: Date): Promise<Map<string, ViewReading>> {
  const views = () => getSupabaseClient().from("x_watch_feed_views");
  const { data: walk, error } = await views()
    .select("walked_at")
    .eq("x_account", currentXAccount())
    .gte("walked_at", from.toISOString())
    .lte("walked_at", to.toISOString())
    .order("walked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not find the walk before: ${error.message}`);
  if (!walk) return new Map();
  // tweet_id is a bigint, which JSON would round, so it is read as text.
  const rows = await fetchAllRows<{ tweet_id: string; impressions: number | null; observed_at: string }>(
    () => views().select("tweet_id::text, impressions, observed_at").eq("x_account", currentXAccount()).eq("walked_at", walk.walked_at),
    "tweet_id",
    { label: "x-watch.storedReadings" },
  );
  // A reading without a count is no reading, as in getRecordedViews.
  return new Map(rows.filter((r) => r.impressions !== null).map((r) => [r.tweet_id, { impressions: Number(r.impressions), observedAtMs: Date.parse(r.observed_at) }]));
}

/** The posts that arrived in the account's feed over the last
 *  SCORE_HISTORY_DAYS, with their best scores (migration 203). */
export async function readScoreHistory(now: Date): Promise<ScoreHistory> {
  const since = new Date(now.getTime() - SCORE_HISTORY_DAYS * 24 * 3_600_000);
  const { data, error } = await getSupabaseClient().rpc("x_watch_best_scores", { p_account: currentXAccount(), p_since: since.toISOString() })
    .single<{ history_from: string | null; best_scores: number[] }>();
  if (error) throw new Error(`Could not read the score history: ${error.message}`);
  const hours = data.history_from === null ? 0 : (now.getTime() - Date.parse(data.history_from)) / 3_600_000;
  return { hours, bestScores: data.best_scores };
}

/** The share of the account's last finished posts on which Claude wrote a
 *  note, whatever X did with it. 1 while there are none. */
export async function readNoteRate(): Promise<number> {
  const { data, error } = await runs()
    .select("note_text")
    .eq("x_account", currentXAccount())
    .in("outcome", ["submitted", "rejected"])
    .order("created_at", { ascending: false })
    .limit(RUNS_FOR_NOTE_RATE);
  if (error) throw new Error(`Could not read the note rate: ${error.message}`);
  return data.length ? data.filter((row) => row.note_text !== null).length / data.length : 1;
}
