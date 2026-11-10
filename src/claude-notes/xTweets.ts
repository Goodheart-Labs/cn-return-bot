/* The X tweets the Claude note writer checks (GOO-527). The whole flow is
 * described in src/pipeline/orchestration/claudeTweets.ts. These are the reads
 * and writes that the runner on ai-box and its Claudes make on the tweets'
 * pipeline_runs rows. Every write is guarded by the row's stage, so a Claude
 * that answers twice, or a retry after a note was saved, changes nothing. */

import type { Json } from "../everything-core/database.types";
import { fetchAllRows } from "../everything-core/paging";
import { CLAUDE_CODE_BOT, CLAUDE_RUNNING_STAGE, CLAUDE_TWEET_MAX_WAIT_MINUTES, CLAUDE_WAITING_STAGE } from "../pipeline/orchestration/claudeTweets";
import { countNoteLength } from "../pipeline/utils/noteLength";
import { db } from "../serviceDb";

/** X's limit, where every link counts as one character. */
export const X_NOTE_MAX_CHARS = 280;
const URL_PATTERN = /https?:\/\/\S+/g;
/** The status the pipeline gives a note it wants to submit. */
const NOTE_STATUS = "CORRECTION WITH TRUSTWORTHY CITATION";
/** How much of a tweet's wait a Claude needs to answer it. The X run sweeps a
 *  tweet as failed once its row is CLAUDE_TWEET_MAX_WAIT_MINUTES old, and it
 *  sweeps whenever it starts. It starts every 30 minutes, but it may start a
 *  moment after a tweet passed that age, so the gap between X runs gives no
 *  extra time we can count on. A tweet's subagent took 1.5 to 2.6 minutes on
 *  2026-11-10. A Claude that ends without its answer gets a second try, and the
 *  session may take a while to start its subagents when it is busy. Thirty
 *  minutes is ten times the slowest tweet, so even two slow tries finish in time. */
const TWEET_ANSWER_MARGIN_MINUTES = 30;

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

/** The waiting tweets a Claude can still answer before the X run sweeps them,
 *  newest first. A tweet that is too old would be swept while its Claude
 *  works, and its answer would be refused. Newest first, because a note is
 *  worth more the fresher its tweet is, and because after a backlog the oldest
 *  tweets are the ones closest to being swept. */
export function tweetsToStart(waiting: XTweet[], now: Date): XTweet[] {
  const oldestStartable = new Date(now.getTime() - (CLAUDE_TWEET_MAX_WAIT_MINUTES - TWEET_ANSWER_MARGIN_MINUTES) * 60_000);
  return waiting.filter((tweet) => new Date(tweet.createdAt) > oldestStartable).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
