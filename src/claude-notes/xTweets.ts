/* The X tweets the Claude note writer checks (GOO-527). The whole flow is
 * described in src/pipeline/orchestration/claudeTweets.ts. These are the reads
 * and writes that the runner on ai-box and its Claudes make on the tweets'
 * pipeline_runs rows. Every write is guarded by the row's stage, so a Claude
 * that answers twice, or a retry after a note was saved, changes nothing. */

import type { Json } from "../everything-core/database.types";
import { fetchAllRows } from "../everything-core/paging";
import { CLAUDE_CODE_BOT, CLAUDE_RUNNING_STAGE, CLAUDE_WAITING_STAGE } from "../pipeline/orchestration/claudeTweets";
import { countNoteLength } from "../pipeline/utils/noteLength";
import { db } from "./store";

/** X's limit, where every link counts as one character. */
export const X_NOTE_MAX_CHARS = 280;
const URL_PATTERN = /https?:\/\/\S+/g;
/** The status the pipeline gives a note it wants to submit. */
const NOTE_STATUS = "CORRECTION WITH TRUSTWORTHY CITATION";

export interface XTweet {
  runId: string;
  tweetId: string;
  createdAt: string;
  stage: string;
  input: string;
  /** The A/B picks of the X run, which decide parts of the prompt. */
  picks: Record<string, string>;
}

export async function openXTweets(): Promise<{ waiting: XTweet[]; running: XTweet[] }> {
  const rows = await fetchAllRows<{ id: string; tweet_id: string; created_at: string; final_stage: string; input: string; ab_test_picks: Record<string, string> }>(
    () => db()
      .from("pipeline_runs")
      .select("id, tweet_id, created_at, final_stage, input:logs->claude->>input, ab_test_picks")
      .eq("bot_name", CLAUDE_CODE_BOT)
      .eq("outcome", "in_progress")
      .in("final_stage", [CLAUDE_WAITING_STAGE, CLAUDE_RUNNING_STAGE]),
    "id",
    { label: "openXTweets" },
  );
  const tweets = rows
    .map((r) => ({ runId: r.id, tweetId: r.tweet_id, createdAt: r.created_at, stage: r.final_stage, input: r.input, picks: r.ab_test_picks }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { waiting: tweets.filter((t) => t.stage === CLAUDE_WAITING_STAGE), running: tweets.filter((t) => t.stage === CLAUDE_RUNNING_STAGE) };
}

async function readClaudeLog(runId: string): Promise<{ logs: Record<string, unknown>; claude: Record<string, unknown> }> {
  const { data, error } = await db().from("pipeline_runs").select("logs").eq("id", runId).single();
  if (error) throw new Error(JSON.stringify(error));
  const logs = (data.logs ?? {}) as Record<string, unknown>;
  return { logs, claude: (logs.claude ?? {}) as Record<string, unknown> };
}

/** Updates an open row and adds `claudeLog` to its logs.claude. Throws when the
 *  row is no longer open, so a Claude learns that its answer was not taken. */
async function updateOpenRow(runId: string, claudeLog: Record<string, unknown>, columns: Record<string, unknown>) {
  const { logs, claude } = await readClaudeLog(runId);
  const { data, error } = await db()
    .from("pipeline_runs")
    .update({ ...columns, logs: { ...logs, claude: { ...claude, ...claudeLog } } as Json })
    .eq("id", runId)
    .eq("bot_name", CLAUDE_CODE_BOT)
    .eq("outcome", "in_progress")
    .select("id");
  if (error) throw new Error(JSON.stringify(error));
  if (!data.length) throw new Error(`Run ${runId} is not an open X tweet of the Claude note writer`);
}

export async function markXTweetRunning(runId: string, attempt: number) {
  await updateOpenRow(runId, { startedAt: new Date().toISOString(), attempt }, { final_stage: CLAUDE_RUNNING_STAGE });
}

/** Everything that is wrong with a note by X's rules. */
export function xNoteProblems(note: string): string[] {
  const problems: string[] = [];
  const length = countNoteLength(note);
  if (length > X_NOTE_MAX_CHARS) problems.push(`The note has ${length} characters, counting each link as one. X allows ${X_NOTE_MAX_CHARS}.`);
  if (!note.match(URL_PATTERN)) problems.push("The note has no link. X requires at least one source link.");
  return problems;
}

/** Saves Claude's note and puts it in the note queue, from where the next X
 *  run rates and submits it. */
export async function saveXNote(runId: string, note: { note: string; reasoning: string }) {
  const text = note.note.trim();
  const problems = xNoteProblems(text);
  if (problems.length) throw new Error(`The note was not saved. ${problems.join(" ")}`);
  await updateOpenRow(runId, { note: text, reasoning: note.reasoning, answeredAt: new Date().toISOString() }, {
    outcome: "candidate",
    outcome_reason: "queued",
    final_stage: "candidate",
    note_text: text,
    source_url: text.match(URL_PATTERN)!.join(" "),
    note_status: NOTE_STATUS,
  });
}

export async function declineXTweet(runId: string, reason: string) {
  await updateOpenRow(runId, { reason, answeredAt: new Date().toISOString() }, {
    outcome: "rejected",
    outcome_reason: "no_correction_needed",
    final_stage: "note_writing",
  });
}

export async function failXTweet(runId: string, reason: string) {
  await updateOpenRow(runId, { failure: reason }, { outcome: "failed", outcome_reason: "claude_no_answer", final_stage: "error", error_message: reason });
}

export async function xTweetIsOpen(runId: string): Promise<boolean> {
  const { data, error } = await db().from("pipeline_runs").select("outcome").eq("id", runId).single();
  if (error) throw new Error(JSON.stringify(error));
  return data.outcome === "in_progress";
}
