/* The Claude note writer's runner (GOO-580). It runs all the time on Nathan's
 * ai-box as a systemd service, under Nathan's user, because Claude Code uses
 * the login in his home folder. It does what the permanent Claude session on
 * the devbox did by hand: it watches the queue, takes each post, starts one
 * Claude for it, and finishes or hands back the item when that Claude is done.
 * It also starts one Claude for each reviewer message on the review page, and
 * runs the note judge on every note as soon as it is posted (GOO-591), whose
 * two probabilities the review page shows.
 *
 * Every Claude runs in its own tmux session, so a person can attach and watch
 * it. Its files are in its run folder under /tmp/cn-notes, the place Nathan's
 * guard hook lets unattended runs write to.
 *
 * Usage: bun run claude-notes run */

import { spawnSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import * as path from "path";
import { judgePrompt, runJudge } from "./judge";
import {
  claudeDraftsSince,
  draftsToJudge,
  latestEventId,
  postedAfter,
  recordUsage,
  claudeQueue,
  finishItem,
  handBack,
  logEvent,
  type QueueItem,
  postDir,
  readDraft,
  readItem,
  readJudgedNote,
  readSettings,
  saveJudgement,
  skipItem,
  unansweredMessages,
} from "./store";
import { take } from "./take";
import { readUsage, type UsageReading } from "./usage";

const REPO = path.resolve(import.meta.dir, "../..");
const POLL_MS = 30_000;
/** Posts in progress at once. The queue puts reader requests first, so a
 *  request takes the next free slot. The feed run spaces Claude's feed posts
 *  by the weekly usage (src/everything/usagePacing.ts), so this limit is
 *  rarely reached. */
const MAX_POSTS_RUNNING = 5;
/** An item the runner has not started this long after it first saw it goes to
 *  the pipeline. That is the backup for when Claude cannot run: the box is
 *  paused, Nathan's week is nearly used up, or something is broken. */
const HAND_BACK_AFTER_MS = 30 * 60_000;
/** Above this share of Nathan's weekly limit no new post is started. The feed
 *  run already stops giving Claude feed posts at 80% (usagePacing.ts), so this
 *  stop holds back mainly reader requests, which Claude takes without pacing. */
const MAX_WEEKLY_USAGE_PERCENT = 90;
/** The usage endpoint is rate limited, and Nathan's pacer reads it too. */
const USAGE_READ_EVERY_MS = 5 * 60_000;
/** A Claude that exits without a report gets one more try. */
const MAX_ATTEMPTS = 2;
const EXAMPLES_EVERY_MS = 24 * 3600_000;
/** Judges running at once. They share Nathan's weekly limit with the posts,
 *  so they run one at a time. */
const MAX_JUDGES_RUNNING = 1;

const PAUSE_FILE = process.env.CN_PAUSE_FILE ?? "/srv/ai-box/PAUSE";
const RUN_SETTINGS = process.env.CN_RUN_SETTINGS ?? "/srv/ai-box/run-settings.json";
const ENV_FILE = process.env.CN_ENV_FILE ?? "/etc/cn-notes/env";
const EXAMPLES_PATH = process.env.CN_EXAMPLES_PATH ?? path.join(REPO, "docs/note-examples.md");
const CLAUDE_BIN = process.env.CN_CLAUDE_BIN ?? path.join(homedir(), ".local/bin/claude");
const RUNS_DIR = "/tmp/cn-notes";
const POST_SESSION_PREFIX = "cn-post-";
const MESSAGE_SESSION_PREFIX = "cn-msg-";

type Run = { session: string; runDir: string; attempt: number; startedAt: number; weeklyAtStart: number | null };

const posts = new Map<string, Run & { item: QueueItem }>();
const answers = new Map<string, Run>();
/** Drafts whose message Claude failed to answer twice. They wait for a person. */
const unanswerable = new Set<string>();
/** When the runner first saw each item waiting. */
const firstSeen = new Map<string, number>();
let usage: UsageReading | null = null;
let usageReadAt = 0;
let examplesBuiltAt = 0;
/** Drafts being judged now, the ones still to judge, the last "posted" entry
 *  of the log the runner has seen, and how often the judge failed on each
 *  draft. A draft that failed MAX_ATTEMPTS times waits for a restart of the
 *  runner. */
const judging = new Set<string>();
const judgeQueue: string[] = [];
let lastPostedEventId = 0;
const judgeFailures = new Map<string, number>();

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function postPrompt(item: QueueItem, dir: string, runDir: string): string {
  return `You are the level-1 agent for one Common Notes post. Follow src/claude-notes/agentBrief.md in this checkout, level 1. The examples file is ${EXAMPLES_PATH}.

The post folder is ${dir}. It holds post.md, meta.json and, for a video, cues.json. The item id is ${item.id}.

Your run folder is ${runDir}. Write every scratch and draft file there, and tell your subagents to do the same.

When you are done, write ${runDir}/report.json with this shape and stop. Do not run finish; the runner does that.

{ "passages": [{ "passage": "...", "outcome": "note | no_note_needed | too_hard | skipped_existing_note" }],
  "pipelineNotes": [{ "noteId": "...", "decision": "kept | deleted", "reason": "..." }] }

If the post has nothing worth checking (a game trailer, show highlights, a music video, a comedy sketch, a personal memoir), write { "skipped": true, "reason": "..." } instead.`;
}

function messagePrompt(params: { text: string; from: string; draft: unknown; url: string; dir: string; runDir: string }): string {
  return `A reviewer asked about one of the Claude note writer's notes on commonnotes.net. Answer them.

Their message: ${params.text}
From: ${params.from}
The draft, as JSON: ${JSON.stringify(params.draft)}
The post: ${params.url}
The post folder: ${params.dir} (it may be missing if the post was checked on another machine; then read the page itself)
Your run folder: ${params.runDir}

Read src/claude-notes/agentBrief.md and ${EXAMPLES_PATH} first. Research on the web when the question needs it. Then write a JSON file to your run folder and run \`bun run claude-notes answer <file>\`:

{ "draftId": "<draft id>", "reply": "<your answer, a few plain sentences>", "note": "<only if the note should change: the improved note text>", "sources": [<only with a new note whose sources changed: sources with Haiku-checked quotes, as in the brief>], "reason": "<only with a new note: why it changed>" }

If the reviewer asks you to change the note, write the improved text as "note". It does not replace the note: the reviewer sees it on the review page and posts it if they agree. Declining a suggestion is fine when your research shows it is wrong; say why in the reply.`;
}

// ---------------------------------------------------------------------------
// Claude sessions
// ---------------------------------------------------------------------------

const tmuxAlive = (session: string) => spawnSync("tmux", ["has-session", "-t", `=${session}`]).status === 0;

/** Starts `claude -p` in a detached tmux session. The secrets come from the
 *  env file inside the session, so they never appear in a process's
 *  arguments. The service secret is removed again, because the agents never
 *  call the services box; only `take` in this runner does. */
function startClaude(session: string, runDir: string, prompt: string) {
  writeFileSync(path.join(runDir, "prompt.md"), prompt);
  const script = [
    "set -a",
    `. ${ENV_FILE}`,
    "set +a",
    "unset SERVICE_AUTH_SECRET EXTRACTION_URL",
    `export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"`,
    `cd ${REPO}`,
    `"${CLAUDE_BIN}" -p "$(cat ${runDir}/prompt.md)" --model opus --permission-mode bypassPermissions --settings ${RUN_SETTINGS} --output-format stream-json --verbose > ${runDir}/stream.jsonl 2> ${runDir}/stderr.txt`,
    `echo $? > ${runDir}/exit-code`,
  ].join("\n");
  writeFileSync(path.join(runDir, "run.sh"), script);
  const started = spawnSync("tmux", ["new-session", "-d", "-s", session, "bash", path.join(runDir, "run.sh")]);
  if (started.status !== 0) throw new Error(`tmux could not start ${session}: ${started.stderr}`);
}

function runFolder(name: string): string {
  const dir = path.join(RUNS_DIR, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Usage of Nathan's plan
// ---------------------------------------------------------------------------

/** The latest reading, at most 5 minutes old. Each new reading is stored for
 *  the admin dashboard's usage chart. A failed read keeps the last one, and
 *  with no reading at all no post starts. */
async function weeklyUsage(): Promise<number | null> {
  if (Date.now() - usageReadAt > USAGE_READ_EVERY_MS) {
    usageReadAt = Date.now();
    try {
      usage = await readUsage();
      await recordUsage(usage);
    } catch (err) {
      console.error(`Could not read the usage: ${(err as Error).message}`);
    }
  }
  return usage?.weekly ?? null;
}

async function mayStartPosts(): Promise<boolean> {
  if (existsSync(PAUSE_FILE)) return false;
  const weekly = await weeklyUsage();
  return weekly !== null && weekly < MAX_WEEKLY_USAGE_PERCENT;
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

async function startPost(item: QueueItem, attempt = 1) {
  const runDir = runFolder(item.id);
  console.log(`Taking ${item.url}`);
  let taken;
  try {
    taken = await take(item.id);
  } catch (err) {
    console.log(`Handing back ${item.url}: ${(err as Error).message}`);
    await handBack(item.id, `The Claude note writer could not read the post: ${(err as Error).message}`);
    return;
  }
  if (taken.kind === "skipped") return console.log(`Skipped ${item.url}: ${taken.reason}`);
  const session = POST_SESSION_PREFIX + item.id.slice(0, 8);
  startClaude(session, runDir, postPrompt(item, taken.dir, runDir));
  posts.set(item.id, { item, session, runDir, attempt, startedAt: Date.now(), weeklyAtStart: await weeklyUsage() });
  console.log(`Started ${session} on ${item.url} (attempt ${attempt})`);
}

function readReport(runDir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path.join(runDir, "report.json"), "utf8"));
  } catch {
    return null;
  }
}

/** Whether the post's Claude saved any draft after it started. A retry of
 *  such a post could post the same notes twice. */
async function savedDrafts(run: Run & { item: QueueItem }): Promise<boolean> {
  return (await claudeDraftsSince(run.item.id, new Date(run.startedAt).toISOString())) > 0;
}

async function endPost(run: Run & { item: QueueItem }) {
  posts.delete(run.item.id);
  const report = readReport(run.runDir);
  const usageNote = { weeklyAtStart: run.weeklyAtStart, weeklyAtEnd: await weeklyUsage(), minutes: Math.round((Date.now() - run.startedAt) / 60_000), attempt: run.attempt };
  console.log(`${run.session} ended after ${usageNote.minutes} minutes, ${report ? "with" : "without"} a report`);
  if (report?.skipped) return skipItem(run.item.id, String(report.reason ?? "nothing worth checking"));
  if (report) return finishItem(run.item.id, { ...report, ...usageNote });
  if (await savedDrafts(run)) return finishItem(run.item.id, { incomplete: true, reason: `Claude exited without a report after saving drafts; see ${run.runDir}`, ...usageNote });
  if (run.attempt < MAX_ATTEMPTS) return startPost(run.item, run.attempt + 1);
  await handBack(run.item.id, `The Claude note writer exited twice without a report; see ${run.runDir} on ai-box`);
}

/** After a restart, a post that is still taken either has its Claude still
 *  running, which the runner adopts, or lost it, and is taken again. */
async function adoptTakenPosts(taken: QueueItem[]) {
  for (const item of taken) {
    const session = POST_SESSION_PREFIX + item.id.slice(0, 8);
    const runDir = runFolder(item.id);
    if (tmuxAlive(session)) posts.set(item.id, { item, session, runDir, attempt: 1, startedAt: Date.now(), weeklyAtStart: null });
    else await startPost(item);
  }
}

/** Hands back every item that has waited 30 minutes since the runner first
 *  saw it. The clock does not start at the item's creation, because an item
 *  raised to the request tier keeps its old creation time. */
async function handBackLongWaits(waiting: QueueItem[]) {
  const now = Date.now();
  for (const item of waiting) {
    const seen = firstSeen.get(item.id) ?? now;
    firstSeen.set(item.id, seen);
    if (now - seen < HAND_BACK_AFTER_MS) continue;
    console.log(`Handing back ${item.url}: it waited 30 minutes`);
    await handBack(item.id, "It waited 30 minutes in the queue without the Claude note writer starting it");
    firstSeen.delete(item.id);
  }
}

// ---------------------------------------------------------------------------
// Reviewer messages
// ---------------------------------------------------------------------------

async function startAnswers() {
  const waiting = new Map<string, { text: string; from: string }>();
  for (const m of await unansweredMessages()) waiting.set(m.draft_id!, { text: (m.data as { text: string }).text, from: m.actor });
  for (const [draftId, message] of waiting) {
    if (answers.has(draftId) || unanswerable.has(draftId)) continue;
    await startAnswer(draftId, message, 1);
  }
}

async function startAnswer(draftId: string, message: { text: string; from: string }, attempt: number) {
  const draft = await readDraft(draftId);
  const item = await readItem(draft.item_id);
  const runDir = runFolder(`message-${draftId}-${Date.now()}`);
  const session = MESSAGE_SESSION_PREFIX + draftId.slice(0, 8);
  const { passage, note, sources, reasoning, outcome, status } = draft;
  startClaude(session, runDir, messagePrompt({ ...message, draft: { id: draftId, passage, note, sources, reasoning, outcome, status }, url: item.url, dir: postDir(item.url), runDir }));
  answers.set(draftId, { session, runDir, attempt, startedAt: Date.now(), weeklyAtStart: null });
  console.log(`Started ${session} to answer ${message.from} on draft ${draftId}`);
}

/** A message Claude did not answer gets one more try, then waits for a person. */
async function endAnswers() {
  const open = new Map((await unansweredMessages()).map((m) => [m.draft_id!, { text: (m.data as { text: string }).text, from: m.actor }]));
  for (const [draftId, run] of answers) {
    if (tmuxAlive(run.session)) continue;
    answers.delete(draftId);
    const message = open.get(draftId);
    if (!message) continue;
    if (run.attempt < MAX_ATTEMPTS) await startAnswer(draftId, message, run.attempt + 1);
    else {
      unanswerable.add(draftId);
      await logEvent({ actor: "claude", type: "answer_failed", draftId, data: { runDir: run.runDir } });
    }
  }
}

// ---------------------------------------------------------------------------
// The note judge
// ---------------------------------------------------------------------------

async function judgeOne(draftId: string) {
  try {
    const note = await readJudgedNote(draftId);
    const judgement = await runJudge(runFolder(`judge/${draftId}-${Date.now()}`), judgePrompt(note));
    await saveJudgement(draftId, note.note, judgement);
    console.log(`Judged draft ${draftId}: P(helpful) ${judgement.pHelpful}, P(impactful) ${judgement.pImpactful}`);
  } catch (err) {
    judgeFailures.set(draftId, (judgeFailures.get(draftId) ?? 0) + 1);
    console.error(`Could not judge draft ${draftId}: ${(err as Error).message}`);
  }
}

function queueForJudge(draftId: string) {
  if (!judging.has(draftId) && !judgeQueue.includes(draftId) && (judgeFailures.get(draftId) ?? 0) < MAX_ATTEMPTS) judgeQueue.push(draftId);
}

/** Judges every note as soon as it is posted, one at a time, while the runner
 *  may start posts. On its first tick the runner also queues every note that
 *  still has no answer for its current text, newest first. After that it only
 *  reads the posts the log recorded since the last tick. */
async function judgeNotes(first: boolean) {
  if (first) {
    lastPostedEventId = await latestEventId();
    for (const draftId of await draftsToJudge()) queueForJudge(draftId);
  } else {
    for (const posted of await postedAfter(lastPostedEventId)) {
      queueForJudge(posted.draftId);
      lastPostedEventId = posted.id;
    }
  }
  while (judging.size < MAX_JUDGES_RUNNING && judgeQueue.length > 0 && (await mayStartPosts())) {
    const draftId = judgeQueue.shift()!;
    judging.add(draftId);
    void judgeOne(draftId).finally(() => judging.delete(draftId));
  }
}

// ---------------------------------------------------------------------------
// The examples file
// ---------------------------------------------------------------------------

/** Rebuilds the examples once a day, outside the checkout. The first build
 *  starts from the checkout's copy, because a rebuild keeps old entries that
 *  prod no longer yields. */
function refreshExamples() {
  if (Date.now() - examplesBuiltAt < EXAMPLES_EVERY_MS) return;
  examplesBuiltAt = Date.now();
  if (!existsSync(EXAMPLES_PATH)) copyFileSync(path.join(REPO, "docs/note-examples.md"), EXAMPLES_PATH);
  const built = spawnSync("bun", [path.join(REPO, "src/claude-notes/buildExamples.ts")], { cwd: REPO, env: { ...process.env, CN_EXAMPLES_PATH: EXAMPLES_PATH }, encoding: "utf8" });
  console.log(built.status === 0 ? built.stdout.trim() : `The examples rebuild failed: ${built.stderr}`);
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

async function tick(first: boolean) {
  await weeklyUsage();
  for (const run of [...posts.values()]) if (!tmuxAlive(run.session)) await endPost(run);
  await endAnswers();
  await judgeNotes(first);
  if ((await readSettings()).writer !== "claude") return;
  if (!existsSync(PAUSE_FILE)) await startAnswers();
  const queue = await claudeQueue();
  if (first) await adoptTakenPosts(queue.taken);
  let waiting = queue.waiting;
  while (waiting.length > 0 && posts.size < MAX_POSTS_RUNNING && (await mayStartPosts())) {
    await startPost(waiting[0]!);
    waiting = waiting.slice(1);
  }
  await handBackLongWaits(waiting);
}

async function main() {
  mkdirSync(RUNS_DIR, { recursive: true });
  console.log(`Claude note writer runner started in ${REPO}`);
  for (let first = true; ; first = false) {
    refreshExamples();
    await tick(first);
    await Bun.sleep(POLL_MS);
  }
}

await main();
