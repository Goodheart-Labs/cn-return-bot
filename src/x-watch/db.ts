/** The database reads and writes of cn-x-watch (GOO-851). Every query reads
 *  only the rows of this process's X account (src/api/xAccount.ts). A failed
 *  query throws, and main.ts counts that tick as failed. */

import { getSupabaseClient, type SupabaseLogger } from "../api/supabaseClient";
import { currentXAccount } from "../api/xAccount";
import type { WrittenNote } from "../api/fetchNotesWritten";
import { fetchAllRows, fetchInBatches } from "../everything-core/paging";
import { NEW_WRITER_DAILY_LIMIT, type WriterState } from "./room";

/** What a test-mode note's run says instead of a note id. Test notes are not
 *  public, so they get no row in `notes`. */
export const TEST_MODE_REASON = "test_mode";
const QUEUED_REASON = "queued";
const SUBMISSION_WINDOW_HOURS = 24;

const runs = () => getSupabaseClient().from("pipeline_runs");

/** The account's own keys in pipeline_state, such as `wsdm:writing_limit`. */
export const stateKey = (name: "admitted_at" | "writing_limit" | "limit_hit_at" | "test_notes_announced") => `${currentXAccount()}:${name}`;

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
    return { kind: "testing", testNotesSubmitted };
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
