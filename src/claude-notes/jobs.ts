/* What happens before and after a Claude works on one job of the note writer:
 * a post, an X tweet, a reviewer message or a creator's X account. Both hosts share it: the runner
 * on Nathan's ai-box (runner.ts), which starts a `claude -p` per job, and the
 * dispatcher on the devbox (dispatch.ts), which hands each job to the
 * permanent Claude session there. The host only starts the Claude and notices
 * when it ended. Everything written to the database is done here, the same
 * way on both. */

import { spawnSync } from "child_process";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import * as path from "path";
import {
  claudeDraftsSince,
  draftsToJudge,
  endPostRun,
  latestEventId,
  logEvent,
  postDir,
  postedAfter,
  type PostRunOutcome,
  type QueueItem,
  readDraft,
  readItem,
  readJudgedNote,
  recordClaudeRun,
  saveJudgement,
  startPostRun,
  unansweredMessages,
} from "./store";
import { JUDGE_EXAMPLES_PATH, type JudgedNote, JUDGEMENT_FILE, judgePrompt, parseJudgement, runJudge, type JudgeExample } from "./judge";
import { REPO } from "./prompts";
import { take, type AskedPassages } from "./take";
import { fetchUsageSnapshot } from "../everything/db";
import { computeClaudePacing, describeClaudePacing, MAX_WEEKLY_USAGE_PERCENT } from "../everything/usagePacing";
import type { Json } from "../everything-core/database.types";
import { CLAUDE_NOTEWRITER } from "../notewriters/ids";
import { fail, finish, nextPost, status, subscribe } from "../notewriters/protocol";
import { pickVariantName } from "../pipeline/ab-testing/abTests";
import { CLAUDE_CN_TASTE_TEST } from "../pipeline/ab-testing/abTestsData";
import { CLAUDE_CODE_BOT } from "../pipeline/orchestration/claudeTweets";
import { type CreatorToLookUp, xHandleChecked } from "./xAccounts";
import { failXTweet, markXTweetRunning, xTweetIsOpen, type XTweet } from "./xTweets";
import { CLAUDE_RUN_TAGS, type ClaudeRunTag } from "./usageShare";

/** A Claude that ends without its answer gets one more try. */
export const MAX_ATTEMPTS = 2;

/** One Claude's work on a job. The host fills in what the run cost on the API
 *  when the Claude ends, or null when it cannot tell. */
export type JobRun = { runDir: string; attempt: number; startedAt: number; weeklyAtStart: number | null };
export type JobEnd = { weeklyAtEnd: number | null; apiCostUsd: number | null };
/** After a Claude ended: the job is closed, or it should get another Claude. */
export type JobOutcome = "closed" | "retry";

function recordRun(run: JobRun, end: JobEnd, tags: ClaudeRunTag[], ref: Parameters<typeof recordClaudeRun>[0]["ref"]) {
  return recordClaudeRun({ tags, startedAt: run.startedAt, runDir: run.runDir, apiCostUsd: end.apiCostUsd, ref });
}

// ---------------------------------------------------------------------------
// The subscription
// ---------------------------------------------------------------------------

/** The plan's weekly usage at which this runner starts nothing new:
 *  CN_STOP_AT_PERCENT for a second runner on a plan its owner also uses. */
export function stopAtPercent(): number {
  const set = process.env.CN_STOP_AT_PERCENT;
  return set ? Math.min(Number(set), MAX_WEEKLY_USAGE_PERCENT) : MAX_WEEKLY_USAGE_PERCENT;
}

/** Turns the plan's weekly usage into Claude's subscription to the queue
 *  (GOO-724). Below the target, Claude wants a feed post as often as the usage
 *  pacing allows, and it takes reader requests. At the target it takes reader
 *  requests only. Above MAX_WEEKLY_USAGE_PERCENT, while paused, or without a
 *  reading, it takes nothing. A notewriter with nothing to take is never
 *  counted as silent, so the feed run stays green while Claude rests. */
export async function updateClaudeSubscription(weekly: number | null, paused: boolean): Promise<void> {
  if (paused || weekly === null || weekly >= stopAtPercent()) {
    await subscribe(CLAUDE_NOTEWRITER, null, false);
    console.log(`Subscription: nothing, because ${paused ? "the runner is paused" : weekly === null ? "the usage is unknown" : `the plan is at ${weekly}%`}`);
    return;
  }
  // A second runner (CN_EVERY_MINUTES) asks for a feed post at a fixed
  // interval, because the shared pacing below reads claude-ai-box's plan, not
  // this one. It takes reader requests only with CN_READER_REQUESTS=1.
  const fixedMinutes = Number(process.env.CN_EVERY_MINUTES) || (process.env.CN_POSTS_ONLY === "1" ? 10 : 0);
  if (fixedMinutes > 0) {
    const requests = process.env.CN_READER_REQUESTS === "1";
    await subscribe(CLAUDE_NOTEWRITER, fixedMinutes, requests);
    console.log(`Subscription: a feed post every ${fixedMinutes} minutes, ${requests ? "and" : "no"} reader requests (plan at ${weekly}%)`);
    return;
  }
  const snapshot = await fetchUsageSnapshot();
  const pacing = computeClaudePacing(snapshot);
  if (pacing) console.log(describeClaudePacing(pacing, snapshot));
  const everyMinutes = pacing && Number.isFinite(pacing.intervalMs) ? Math.max(1, Math.ceil(pacing.intervalMs / 60_000)) : null;
  await subscribe(CLAUDE_NOTEWRITER, everyMinutes, true);
  console.log(`Subscription: ${everyMinutes ? `a feed post every ${everyMinutes} minutes` : "no feed posts"}, and reader requests`);
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

/** A post the notewriter protocol handed to Claude, by its assignment. */
export type HeldPost = { assignment: string; item: QueueItem };

/** Asks the queue for one more post. Null when none is due. */
export async function nextClaudePost(): Promise<HeldPost | null> {
  const answer = await nextPost(CLAUDE_NOTEWRITER);
  if (answer.kind !== "post") return null;
  return { assignment: answer.assignment, item: await readItem(answer.item.id) };
}

/** The posts Claude holds now, for a host that starts again. */
export async function heldClaudePosts(): Promise<HeldPost[]> {
  const held: HeldPost[] = [];
  for (const open of (await status(CLAUDE_NOTEWRITER)).open) held.push({ assignment: open.assignment, item: await readItem(open.item.id) });
  return held;
}

/** A post's run row and A/B picks, kept in its run folder. The first attempt
 *  draws the picks and writes the row, and a retry reads them, so both
 *  attempts get the same prompt and the same row. */
export type PostRun = { runId: string; picks: Record<string, string> };
const postRunFile = (runDir: string) => path.join(runDir, "run.json");

async function startPostRunFor(item: QueueItem, runDir: string): Promise<PostRun> {
  const picks = { bot: CLAUDE_CODE_BOT, [CLAUDE_CN_TASTE_TEST.name]: pickVariantName(CLAUDE_CN_TASTE_TEST) };
  const postRun = { runId: await startPostRun(item.id, picks), picks };
  writeFileSync(postRunFile(runDir), JSON.stringify(postRun));
  return postRun;
}

/** A post whose Claude started before the runner wrote run rows has none. */
function readPostRun(runDir: string): PostRun | null {
  return existsSync(postRunFile(runDir)) ? JSON.parse(readFileSync(postRunFile(runDir), "utf8")) : null;
}

export const reportFile = (runDir: string) => path.join(runDir, "report.json");

export type PostStart = { kind: "ready"; dir: string; asked: AskedPassages; postRun: PostRun } | { kind: "not_started" };

/** Takes the post and prepares its run folder. A post Nathan fact-checked is
 *  finished as skipped, and a post that cannot be taken is failed. Neither
 *  gets a Claude. */
export async function beginPost(post: HeldPost, runDir: string, attempt: number): Promise<PostStart> {
  let taken;
  try {
    taken = await take(post.item.id);
  } catch (err) {
    await failPost(post, (err as Error).message);
    return { kind: "not_started" };
  }
  if (taken.kind === "skipped") {
    console.log(`Skipped ${post.item.url}: ${taken.reason}`);
    await finish(post.assignment, { skipReason: taken.reason });
    return { kind: "not_started" };
  }
  // A post Claude checked before has its last report in the same folder. It
  // must not pass for this run's report.
  if (attempt === 1) rmSync(reportFile(runDir), { force: true });
  const postRun = (attempt > 1 && readPostRun(runDir)) || (await startPostRunFor(post.item, runDir));
  return { kind: "ready", dir: taken.dir, asked: taken.asked, postRun };
}

export function readReport(runDir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(reportFile(runDir), "utf8"));
  } catch {
    return null;
  }
}

/** Whether the post's Claude saved any draft after it started. A retry of
 *  such a post could post the same notes twice. */
async function savedDrafts(run: JobRun & HeldPost): Promise<boolean> {
  return (await claudeDraftsSince(run.item.id, new Date(run.startedAt).toISOString())) > 0;
}

/** Closes the post from its Claude's report. Finishing it also answers the
 *  passages readers asked about. Without a report and without drafts the
 *  post gets one more try, and after that Claude fails on it, and the queue
 *  gives it to another notewriter. */
export async function endPost(run: JobRun & HeldPost, end: JobEnd): Promise<JobOutcome> {
  const report = readReport(run.runDir);
  const postRun = readPostRun(run.runDir);
  await recordRun(run, end, [CLAUDE_RUN_TAGS.commonNotes, CLAUDE_RUN_TAGS.post], postRun && { everything_pipeline_run_id: postRun.runId });
  const usageNote = { weeklyAtStart: run.weeklyAtStart, weeklyAtEnd: end.weeklyAtEnd, minutes: Math.round((Date.now() - run.startedAt) / 60_000), attempt: run.attempt };
  console.log(`The Claude on ${run.item.url} ended after ${usageNote.minutes} minutes, ${report ? "with" : "without"} a report`);
  const record = async (outcome: PostRunOutcome) => {
    if (postRun) await endPostRun(postRun.runId, outcome, { runDir: run.runDir, report, ...usageNote });
  };
  if (report?.skipped) {
    await record("skipped");
    await finish(run.assignment, { summary: { ...report, ...usageNote } as Json, skipReason: String(report.reason ?? "nothing worth checking") });
    return "closed";
  }
  if (report) {
    await warnAboutUnsavedNotes(run, report);
    await record("done");
    await finish(run.assignment, { summary: { ...report, ...usageNote } as Json });
    return "closed";
  }
  if (await savedDrafts(run)) {
    await record("incomplete");
    await finish(run.assignment, { summary: { incomplete: true, reason: `Claude exited without a report after saving drafts; see ${run.runDir}`, ...usageNote } });
    return "closed";
  }
  if (run.attempt < MAX_ATTEMPTS) return "retry";
  await record("failed");
  await failPost(run, `Claude exited twice without a report; see ${run.runDir}`);
  return "closed";
}

/** Claude fails on the post. It gets a break, the post goes to the next
 *  notewriter, and the next feed run goes red. */
async function failPost(post: HeldPost, reason: string) {
  const failed = await fail(post.assignment, reason);
  console.log(`Failed on ${post.item.url}: ${reason}. A break until ${failed.cooldown_until}, and the post ${failed.post === "failed" ? "failed, because no notewriter is left for it" : "went back to the queue"}`);
}

/** A report that lists more notes than the post has drafts means some
 *  `draft` calls failed, for example because a guard hook refused them. The
 *  research is then lost unless a person saves the drafts from the run
 *  folder, so the host says so in its log and in the events table. */
async function warnAboutUnsavedNotes(run: JobRun & HeldPost, report: Record<string, unknown>) {
  const passages = (report.passages ?? []) as { outcome?: string }[];
  const reported = passages.filter((p) => p.outcome === "note").length;
  const saved = await claudeDraftsSince(run.item.id, new Date(run.startedAt).toISOString());
  if (saved >= reported) return;
  console.error(`UNSAVED NOTES on ${run.item.url}: the report lists ${reported} notes but only ${saved} drafts were saved. The draft files are in ${run.runDir}`);
  await logEvent({ actor: "claude", type: "notes_unsaved", itemId: run.item.id, data: { reported, saved, runDir: run.runDir } });
}

// ---------------------------------------------------------------------------
// X tweets
// ---------------------------------------------------------------------------

export const beginTweet = (tweet: XTweet, attempt: number) => markXTweetRunning(tweet.runId, attempt);

/** A Claude that exited without a note or a no-note gets one more try. The
 *  stage guards in xTweets.ts make sure an answer is never saved twice. */
export async function endTweet(run: JobRun & { tweet: XTweet }, end: JobEnd): Promise<JobOutcome> {
  await recordRun(run, end, [CLAUDE_RUN_TAGS.x, CLAUDE_RUN_TAGS.tweet], { pipeline_run_id: run.tweet.runId });
  console.log(`The Claude on tweet ${run.tweet.tweetId} ended after ${Math.round((Date.now() - run.startedAt) / 60_000)} minutes`);
  if (!(await xTweetIsOpen(run.tweet.runId))) return "closed";
  if (run.attempt < MAX_ATTEMPTS) return "retry";
  await failXTweet(run.tweet.runId, `The Claude note writer exited twice without an answer; see ${run.runDir}`);
  return "closed";
}

// ---------------------------------------------------------------------------
// Reviewer messages
// ---------------------------------------------------------------------------

export type ReviewerMessage = { text: string; from: string };

/** The newest unanswered message of each draft. */
export async function waitingMessages(): Promise<Map<string, ReviewerMessage>> {
  const waiting = new Map<string, ReviewerMessage>();
  for (const m of await unansweredMessages()) waiting.set(m.draft_id!, { text: (m.data as { text: string }).text, from: m.actor });
  return waiting;
}

/** The draft and post a reviewer's message is about, for its prompt. */
export async function messageContext(draftId: string) {
  const { passage, note, sources, reasoning, outcome, status, item_id } = await readDraft(draftId);
  const item = await readItem(item_id);
  return { draft: { id: draftId, passage, note, sources, reasoning, outcome, status }, url: item.url, dir: postDir(item.url) };
}

/** A message Claude did not answer gets one more try. After that Claude gives
 *  up on it, and it waits for a person. */
export async function endAnswer(draftId: string, run: JobRun, end: JobEnd): Promise<JobOutcome | "gave_up"> {
  await recordRun(run, end, [CLAUDE_RUN_TAGS.commonNotes, CLAUDE_RUN_TAGS.reviewAnswer], { draft_id: draftId });
  if (!(await waitingMessages()).has(draftId)) return "closed";
  if (run.attempt < MAX_ATTEMPTS) return "retry";
  await logEvent({ actor: "claude", type: "answer_failed", draftId, data: { runDir: run.runDir } });
  return "gave_up";
}

// ---------------------------------------------------------------------------
// Creators' X accounts
// ---------------------------------------------------------------------------

/** A lookup that ended without saving an answer gets one more try. After that
 *  the creator waits for a person, who can enter the handle on the review card. */
export async function endXAccountLookup(run: JobRun & { creator: CreatorToLookUp }, end: JobEnd): Promise<JobOutcome | "gave_up"> {
  // The ledger has no column for a project, and the run folder names the creator.
  await recordRun(run, end, [CLAUDE_RUN_TAGS.commonNotes, CLAUDE_RUN_TAGS.xAccount], null);
  console.log(`The Claude looking up ${run.creator.name}'s X account ended after ${Math.round((Date.now() - run.startedAt) / 60_000)} minutes`);
  if (await xHandleChecked(run.creator.slug)) return "closed";
  if (run.attempt < MAX_ATTEMPTS) return "retry";
  console.error(`Gave up on the X account of ${run.creator.name}: two Claudes ended without an answer; see ${run.runDir}`);
  return "gave_up";
}

// ---------------------------------------------------------------------------
// The note judge
// ---------------------------------------------------------------------------

/** What the run would have cost on the API, as Claude Code reports it in the
 *  last event of its output: stream.jsonl for the runner's sessions, and
 *  output.json for a judge. Null when the run died before it reported, and
 *  for a subagent of the devbox session, which writes neither. */
export function runCost(runDir: string): number | null {
  const output = ["stream.jsonl", "output.json"].map((file) => path.join(runDir, file)).find(existsSync);
  if (!output) return null;
  for (const line of readFileSync(output, "utf8").trim().split("\n").reverse()) {
    try {
      const event = JSON.parse(line);
      if (event.type === "result" && typeof event.total_cost_usd === "number") return event.total_cost_usd;
    } catch {
      // A run killed mid-write leaves a cut-off last line.
    }
  }
  return null;
}

/** After a judge subagent of the devbox session returned: saves its answer
 *  for the text it judged. A judge without a valid answer gets one more try,
 *  and after that its note waits for a restart of the queue. */
export async function endJudge(run: JobRun & { draftId: string; note: JudgedNote }, end: JobEnd): Promise<JobOutcome | "gave_up"> {
  await recordRun(run, end, [CLAUDE_RUN_TAGS.commonNotes, CLAUDE_RUN_TAGS.judge], { draft_id: run.draftId });
  try {
    const judgement = parseJudgement(readFileSync(path.join(run.runDir, JUDGEMENT_FILE), "utf8"));
    await saveJudgement(run.draftId, run.note.note, judgement);
    console.log(`Judged draft ${run.draftId}: P(helpful) ${judgement.pHelpful}, P(impactful) ${judgement.pImpactful}`);
    return "closed";
  } catch (err) {
    console.error(`The judge of draft ${run.draftId} gave no answer: ${(err as Error).message}`);
  }
  return run.attempt < MAX_ATTEMPTS ? "retry" : "gave_up";
}

/** Judges running at once. They share the plan's weekly limit with the posts,
 *  so they run one at a time. */
const MAX_JUDGES_RUNNING = 1;

/** Judges every note as soon as it is posted, one at a time, while the host
 *  may start Claudes. On its first tick it also queues every note that still
 *  has no answer for its current text, newest first. After that it only reads
 *  the posts the log recorded since the last tick. The judge is its own
 *  `claude -p` on both hosts, because it must not see the database keys or the
 *  votes it predicts. */
export function noteJudge(host: { runFolder: (name: string) => string; mayStart: () => Promise<boolean>; runSettings?: string }) {
  /** Drafts being judged now, the ones still to judge, the last "posted"
   *  entry of the log seen so far, and how often the judge failed on each
   *  draft. A draft that failed MAX_ATTEMPTS times waits for a restart. */
  const judging = new Set<string>();
  const judgeQueue: string[] = [];
  let lastPostedEventId = 0;
  const judgeFailures = new Map<string, number>();
  /** The labelled notes every judge sees, from the checkout's file. */
  const examplesForJudge: JudgeExample[] = JSON.parse(readFileSync(JUDGE_EXAMPLES_PATH, "utf8"));

  async function judgeOne(draftId: string) {
    const run = { runDir: host.runFolder(`judge/${draftId}-${Date.now()}`), startedAt: Date.now() };
    try {
      const note = await readJudgedNote(draftId);
      const examples = examplesForJudge.filter((e) => e.draftId !== draftId);
      const judgement = await runJudge(run.runDir, judgePrompt(note, examples), host.runSettings);
      await saveJudgement(draftId, note.note, judgement);
      console.log(`Judged draft ${draftId}: P(helpful) ${judgement.pHelpful}, P(impactful) ${judgement.pImpactful}`);
    } catch (err) {
      judgeFailures.set(draftId, (judgeFailures.get(draftId) ?? 0) + 1);
      console.error(`Could not judge draft ${draftId}: ${(err as Error).message}`);
    }
    await recordClaudeRun({ tags: [CLAUDE_RUN_TAGS.commonNotes, CLAUDE_RUN_TAGS.judge], ...run, apiCostUsd: runCost(run.runDir), ref: { draft_id: draftId } });
  }

  function queueForJudge(draftId: string) {
    if (!judging.has(draftId) && !judgeQueue.includes(draftId) && (judgeFailures.get(draftId) ?? 0) < MAX_ATTEMPTS) judgeQueue.push(draftId);
  }

  async function tick(first: boolean) {
    if (first) {
      lastPostedEventId = await latestEventId();
      for (const draftId of await draftsToJudge()) queueForJudge(draftId);
    } else {
      for (const posted of await postedAfter(lastPostedEventId)) {
        queueForJudge(posted.draftId);
        lastPostedEventId = posted.id;
      }
    }
    while (judging.size < MAX_JUDGES_RUNNING && judgeQueue.length > 0 && (await host.mayStart())) {
      const draftId = judgeQueue.shift()!;
      judging.add(draftId);
      void judgeOne(draftId).finally(() => judging.delete(draftId));
    }
  }

  return { tick };
}

// ---------------------------------------------------------------------------
// The examples file
// ---------------------------------------------------------------------------

const EXAMPLES_EVERY_MS = 24 * 3600_000;
let examplesBuiltAt = 0;

/** Rebuilds the examples once a day, outside the checkout. The first build
 *  starts from the checkout's copy, because a rebuild keeps old entries that
 *  prod no longer yields. */
export function refreshExamples(examplesPath: string) {
  if (Date.now() - examplesBuiltAt < EXAMPLES_EVERY_MS) return;
  examplesBuiltAt = Date.now();
  if (!existsSync(examplesPath)) copyFileSync(path.join(REPO, "docs/note-examples.md"), examplesPath);
  const built = spawnSync("bun", [path.join(REPO, "src/claude-notes/buildExamples.ts")], { cwd: REPO, env: { ...process.env, CN_EXAMPLES_PATH: examplesPath }, encoding: "utf8" });
  console.log(built.status === 0 ? built.stdout.trim() : `The examples rebuild failed: ${built.stderr}`);
}
