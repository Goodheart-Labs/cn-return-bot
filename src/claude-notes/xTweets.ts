/* The X tweets the Claude note writer checks (GOO-527), and the posts the
 * Pangram judge looks at (GOO-880). The whole flow is described in
 * src/pipeline/orchestration/claudeTweets.ts and src/x-notes/pangram.ts. These are the reads
 * and writes that the runner on ai-box and its Claudes make on the tweets'
 * pipeline_runs rows. Every write is guarded by the row's stage, so a Claude
 * that answers twice, or a retry after a note was saved, changes nothing. */

import type { XAccount } from "../api/xAccount";
import type { DraftSource } from "./store";
import type { Json } from "../everything-core/database.types";
import { fetchAllRows } from "../everything-core/paging";
import { CLAUDE_BOTS, CLAUDE_CODE_BOT, CLAUDE_RUNNING_STAGE, CLAUDE_WAITING_STAGE, PANGRAM_BOT } from "../pipeline/orchestration/claudeTweets";
import { buildPangramNote, PANGRAM_APPROVED, PANGRAM_NOTE_STATUS, type PangramNoteVariant } from "../pipeline/pangram-monitoring/pangramNote";
import { countNoteLength } from "../pipeline/utils/noteLength";
import { db } from "../serviceDb";

/** X's limit, where every link counts as one character. */
export const X_NOTE_MAX_CHARS = 280;
const URL_PATTERN = /https?:\/\/\S+/g;
/** The status the pipeline gives a note it wants to submit. */
const NOTE_STATUS = "CORRECTION WITH TRUSTWORTHY CITATION";

export interface XTweet {
  runId: string;
  tweetId: string;
  /** The X account the note is for. Its share of the plan pays (xShare.ts). */
  xAccount: XAccount;
  createdAt: string;
  stage: string;
  input: string;
  /** The A/B picks of the X run, which decide parts of the prompt. */
  picks: Record<string, string>;
}

type ClaudeBot = (typeof CLAUDE_BOTS)[number];

/** The open rows of one bot: the tweets for the note writer, or the posts for the Pangram judge. */
export async function openXTweets(bot: ClaudeBot): Promise<{ waiting: XTweet[]; running: XTweet[] }> {
  const rows = await fetchAllRows<{ id: string; tweet_id: string; x_account: XAccount; created_at: string; final_stage: string; input: string; ab_test_picks: Record<string, string> }>(
    () => db()
      .from("pipeline_runs")
      .select("id, tweet_id, x_account, created_at, final_stage, input:logs->claude->>input, ab_test_picks")
      .eq("bot_name", bot)
      .eq("outcome", "in_progress")
      .in("final_stage", [CLAUDE_WAITING_STAGE, CLAUDE_RUNNING_STAGE]),
    "id",
    { label: "openXTweets" },
  );
  const tweets = rows
    .map((r) => ({ runId: r.id, tweetId: r.tweet_id, xAccount: r.x_account, createdAt: r.created_at, stage: r.final_stage, input: r.input, picks: r.ab_test_picks }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { waiting: tweets.filter((t) => t.stage === CLAUDE_WAITING_STAGE), running: tweets.filter((t) => t.stage === CLAUDE_RUNNING_STAGE) };
}

async function readClaudeLog(runId: string): Promise<{ logs: Record<string, unknown>; claude: Record<string, unknown> }> {
  const { data, error } = await db().from("pipeline_runs").select("logs").eq("id", runId).single();
  if (error) throw new Error(JSON.stringify(error));
  const logs = (data.logs ?? {}) as Record<string, unknown>;
  return { logs, claude: (logs.claude ?? {}) as Record<string, unknown> };
}

/** Updates an open row of one of `bots` and adds `claudeLog` to its
 *  logs.claude. Throws when the row is no longer open, so a Claude learns that
 *  its answer was not taken. */
async function updateOpenRow(runId: string, bots: readonly ClaudeBot[], claudeLog: Record<string, unknown>, columns: Record<string, unknown>) {
  const { logs, claude } = await readClaudeLog(runId);
  const { data, error } = await db()
    .from("pipeline_runs")
    .update({ ...columns, logs: { ...logs, claude: { ...claude, ...claudeLog } } as Json })
    .eq("id", runId)
    .in("bot_name", bots)
    .eq("outcome", "in_progress")
    .select("id");
  if (error) throw new Error(JSON.stringify(error));
  if (!data.length) throw new Error(`Run ${runId} is not an open run of ${bots.join(" or ")}`);
}

export async function markXTweetRunning(runId: string, attempt: number) {
  await updateOpenRow(runId, CLAUDE_BOTS, { startedAt: new Date().toISOString(), attempt }, { final_stage: CLAUDE_RUNNING_STAGE });
}

/** The X accounts whose notes must name their sources, each with a quote from
 *  the page and what it supports, as Common Notes' drafts do (GOO-851). Their
 *  Claude checks every source with a Haiku subagent first (prompts.ts). */
export const ACCOUNTS_WITH_SOURCE_DETAILS: readonly XAccount[] = ["wsdm"];

/** Everything that is wrong with a note by X's rules. */
export function xNoteProblems(note: string): string[] {
  const problems: string[] = [];
  const length = countNoteLength(note);
  if (length > X_NOTE_MAX_CHARS) problems.push(`The note has ${length} characters, counting each link as one. X allows ${X_NOTE_MAX_CHARS}.`);
  if (!note.match(URL_PATTERN)) problems.push("The note has no link. X requires at least one source link.");
  return problems;
}

/** Everything that is wrong with a note's source details: every link of the
 *  note needs one, with a quote and what it supports. */
export function sourceProblems(note: string, sources: DraftSource[] | undefined): string[] {
  if (!sources?.length) return ["The note has no sources. Give each of its links in \"sources\" with a quote and what it supports."];
  const problems = sources.filter((s) => !s.url || !s.quote?.trim() || !s.explanation?.trim()).map((s) => `The source ${s.url || "without a url"} needs a url, a quote and an explanation.`);
  const sourceUrls = new Set(sources.map((s) => s.url));
  for (const link of note.match(URL_PATTERN) ?? []) {
    if (!sourceUrls.has(link)) problems.push(`The link ${link} is in the note but not in "sources".`);
  }
  return problems;
}

async function readXAccount(runId: string): Promise<XAccount> {
  const { data, error } = await db().from("pipeline_runs").select("x_account").eq("id", runId).single();
  if (error) throw new Error(JSON.stringify(error));
  return data.x_account as XAccount;
}

/** Saves Claude's note and puts it in the note queue, from where the next X
 *  run rates and submits it. The sources are kept in logs.claude.sources. */
export async function saveXNote(runId: string, note: { note: string; reasoning: string; sources?: DraftSource[] }) {
  const text = note.note.trim();
  const needsSources = ACCOUNTS_WITH_SOURCE_DETAILS.includes(await readXAccount(runId));
  const problems = [...xNoteProblems(text), ...(needsSources ? sourceProblems(text, note.sources) : [])];
  if (problems.length) throw new Error(`The note was not saved. ${problems.join(" ")}`);
  await updateOpenRow(runId, [CLAUDE_CODE_BOT], { note: text, reasoning: note.reasoning, ...(note.sources && { sources: note.sources }), answeredAt: new Date().toISOString() }, {
    outcome: "candidate",
    outcome_reason: "queued",
    final_stage: "candidate",
    note_text: text,
    source_url: text.match(URL_PATTERN)!.join(" "),
    note_status: NOTE_STATUS,
  });
}

export async function declineXTweet(runId: string, reason: string) {
  await updateOpenRow(runId, [CLAUDE_CODE_BOT], { reason, answeredAt: new Date().toISOString() }, {
    outcome: "rejected",
    outcome_reason: "no_correction_needed",
    final_stage: "note_writing",
  });
}

/** Why the runner gave up on a tweet: its Claude never answered, the image
 *  screen stopped it, or the image screen could not run (GOO-815). */
type XTweetFailure = "claude_no_answer" | "image_flagged" | "image_screen_failed";

export async function failXTweet(runId: string, reason: string, outcomeReason: XTweetFailure = "claude_no_answer") {
  await updateOpenRow(runId, CLAUDE_BOTS, { failure: reason }, { outcome: "failed", outcome_reason: outcomeReason, final_stage: "error", error_message: reason });
}

export async function xTweetIsOpen(runId: string): Promise<boolean> {
  const { data, error } = await db().from("pipeline_runs").select("outcome").eq("id", runId).single();
  if (error) throw new Error(JSON.stringify(error));
  return data.outcome === "in_progress";
}

/** The Pangram judge's answer (PANGRAM_VERDICT_SCHEMA in prompts.ts). */
export type PangramVerdict = { reasoning: string; should_get_this_is_ai_written_community_note: boolean };

/** Saves the Pangram judge's verdict (GOO-880). On a yes, the row becomes the
 *  Pangram note in the wording its A/B pick names, and waits for the first
 *  account's writer to submit it (src/x-notes/writer.ts). */
export async function savePangramVerdict(runId: string, verdict: PangramVerdict) {
  const shouldGetNote = verdict.should_get_this_is_ai_written_community_note;
  const claudeLog = { should_get_this_is_ai_written_community_note: shouldGetNote, reasoning: verdict.reasoning, answeredAt: new Date().toISOString() };
  if (!shouldGetNote) {
    await updateOpenRow(runId, [PANGRAM_BOT], claudeLog, { outcome: "rejected", outcome_reason: "pangram_judge_declined", final_stage: "pangram_judge" });
    return;
  }
  const { data, error } = await db().from("pipeline_runs").select("ab_test_picks, report:logs->pangram->>dashboard_link").eq("id", runId).single<{ ab_test_picks: Record<string, string>; report: string | null }>();
  if (error) throw new Error(JSON.stringify(error));
  const note = buildPangramNote(data.report ?? "", data.ab_test_picks.pangram_note as PangramNoteVariant);
  if (!note) throw new Error(`Run ${runId} has no Pangram report link, or its note would be too long`);
  await updateOpenRow(runId, [PANGRAM_BOT], claudeLog, {
    outcome: "candidate",
    outcome_reason: PANGRAM_APPROVED,
    final_stage: "candidate",
    note_text: note.noteText,
    source_url: note.sourceUrl,
    note_status: PANGRAM_NOTE_STATUS,
  });
}
