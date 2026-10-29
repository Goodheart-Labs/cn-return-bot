/* The Claude note writer's runner (GOO-580). It runs all the time on Nathan's
 * ai-box as a systemd service, under Nathan's user, because Claude Code uses
 * the login in his home folder. It does what the permanent Claude session on
 * the devbox did by hand: it watches the queue, takes each post, starts one
 * Claude for it, and finishes the item when that Claude is done. A post it
 * cannot finish is marked as failed, the way the pipeline marks one. Nothing
 * goes to the pipeline: a failure stays visible instead of being covered up.
 * It also starts one Claude for each reviewer message on the review page, and
 * one Claude for each X tweet the X run handed to it (GOO-527, see
 * src/pipeline/orchestration/claudeTweets.ts). And it runs the note judge on
 * every note as soon as it is posted (GOO-591), whose two probabilities the
 * review page shows.
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
import { JUDGE_EXAMPLES_PATH, judgePrompt, runJudge, type JudgeExample } from "./judge";
import {
  claudeDraftsSince,
  draftsToJudge,
  latestEventId,
  postedAfter,
  recordUsage,
  claudeQueue,
  finishItem,
  logEvent,
  type QueueItem,
  postDir,
  readDraft,
  readItem,
  readJudgedNote,
  readSettings,
  recordPostRun,
  type PostRunOutcome,
  saveJudgement,
  skipItem,
  unansweredMessages,
} from "./store";
import { take } from "./take";
import { fetchItem } from "../everything/db";
import { recordItemFailure } from "../everything/worker";
import { readUsage, type UsageReading } from "./usage";
import { MAX_WEEKLY_USAGE_PERCENT } from "../everything/usagePacing";
import { pickVariantName } from "../pipeline/ab-testing/abTests";
import { CLAUDE_CN_TASTE_TEST } from "../pipeline/ab-testing/abTestsData";
import { CLAUDE_CODE_BOT } from "../pipeline/orchestration/claudeTweets";
import { failXTweet, markXTweetRunning, openXTweets, recordXTweetRun, X_NOTE_MAX_CHARS, xTweetIsOpen, type XTweet } from "./xTweets";

const REPO = path.resolve(import.meta.dir, "../..");
const POLL_MS = 30_000;
/** Posts in progress at once. The queue puts reader requests first, so a
 *  request takes the next free slot. The feed run spaces Claude's feed posts
 *  by the weekly usage (src/everything/usagePacing.ts), so this limit is
 *  rarely reached. */
const MAX_POSTS_RUNNING = 5;
/** X tweets in progress at once, on top of the posts. The X share of the week
 *  (src/claude-notes/xShare.ts) decides how many tweets come; this only stops
 *  a burst from one X run from starting all its tweets at the same moment. */
const MAX_TWEETS_RUNNING = 3;
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
/** Built once from the public Community Notes data, by the scripts in
 *  src/scripts_jim/2026_10_27_x_claude_examples/. Every X Claude gets it
 *  appended to its system prompt, so the prompt cache can share it. */
const X_EXAMPLES_PATH = path.join(REPO, "docs/x-note-examples.md");
const CLAUDE_BIN = process.env.CN_CLAUDE_BIN ?? path.join(homedir(), ".local/bin/claude");
const RUNS_DIR = "/tmp/cn-notes";
const POST_SESSION_PREFIX = "cn-post-";
const MESSAGE_SESSION_PREFIX = "cn-msg-";
const TWEET_SESSION_PREFIX = "cn-x-";

type Run = { session: string; runDir: string; attempt: number; startedAt: number; weeklyAtStart: number | null };

const posts = new Map<string, Run & { item: QueueItem }>();
const tweets = new Map<string, Run & { tweet: XTweet }>();
const answers = new Map<string, Run>();
/** Drafts whose message Claude failed to answer twice. They wait for a person. */
const unanswerable = new Set<string>();
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
/** The labelled notes every judge sees, from the checkout's file. */
const examplesForJudge: JudgeExample[] = JSON.parse(readFileSync(JUDGE_EXAMPLES_PATH, "utf8"));

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/** Jim's sentences on what makes a good note, the variant with_thoughts of the
 *  taste tests. Without them Claude learns only from the examples. */
const CN_THOUGHTS = ` (Notes that point out something clearly wrong/misleading are great, notes that point out a minor error can also be good (but there you need some taste to see if it's an actual minor error that the author would be happy to correct) or if the author was just a bit loose in their language as a deliberate choice, notes that add additional context to support the author's point or to explain something with the goal of making readers less confused can be good but this also requires taste: notes in this category can easily be unnecessary for most readers which is bad or the additional detail can add more confusion than clarity)`;
const X_THOUGHTS = `Basically if you can show that something said in the tweet is clearly not true, this is most likely a good note and otherwise it risks getting rated unhelpful. It's important to recognize when someone is joking. `;
/** Jim's nudge to research more, the variant on of claude_x_research_nudge.
 *  Common Notes posts always get their own nudge. */
const X_RESEARCH_NUDGE = ` Different tweets can require completely different orders of magnitude of research. Please make sure you understand the situation deeply and do the necessary research.`;
const WITH_THOUGHTS = "with_thoughts";

function postPrompt(item: QueueItem, dir: string, runDir: string, picks: Record<string, string>): string {
  return `Hi Claude, we are working on a browser extension called Common Notes. We show notes (similar to Community Notes) on Substack articles, YouTube videos and other sites. In your system prompt we added lots of examples of bad and good notes to give you a feeling of what we are looking for${picks.claude_cn_taste === WITH_THOUGHTS ? CN_THOUGHTS : ""}.

The post that you get might be smaller or larger. The longer the context the easier it is to miss something and the way that you can get around this is by using a lot of subagents. So you can do research to figure out what's true, but you should use subagents to check all the specific passages/points (where there's some chance that something could turn out to be misleading in some way). Please be very thorough.

The post that you get might not be worth checking at all. There's not necessarily clean topics that are not worth checking, e.g. even a music video might have a part where someone makes a wrong claim about the world. But generally when people aren't really making claims about the world worth fact-checking or just telling personal stories and nothing else, just playing a game, just a music video, pure entertainment, then you can just not check anything.

## How to work here

The post is in ${dir}. post.md is its text, and meta.json holds its item id (${item.id}), address and creator. For a video, cues.json holds the caption timings. Your run folder is ${runDir}. Write every file there, and tell your subagents to do the same.

To save a note, write a JSON file to your run folder and run \`bun run claude-notes draft <file>\` from ${REPO}. A draft with outcome "note" goes up on commonnotes.net at once as an AI note. So run the command exactly once per draft, with no other arguments.

{ "itemId": "${item.id}",
  "passage": "<copied verbatim from post.md, the shortest span that carries the claim>",
  "claim": "<the passage's claim in neutral self-contained words>",
  "kind": "small_mistake | missing_context | wrong_or_misleading",
  "outcome": "note | no_note_needed | too_hard",
  "note": "<the note text, without links, or empty>",
  "reasoning": "<2 to 4 sentences: what you found and why the note says what it says>",
  "sources": [{ "url": "...", "quote": "<at most 2 sentences copied exactly from the page>", "explanation": "<what it supports>" }] }

Readers see each source's quote under the note, so the quote must appear word for word on the page. WebFetch gives you a summary of a page, not its text. So download each source with curl and check with grep -F that the quote is in it. Also save a draft for each passage you researched and decided against, with outcome no_note_needed or too_hard.

When you are done, write ${runDir}/report.json as { "passages": [{ "passage": "...", "outcome": "note | no_note_needed | too_hard" }] } and stop. Do not run finish; the runner does that. If the post has nothing worth checking, write { "skipped": true, "reason": "..." } instead.`;
}

function tweetPrompt(tweet: XTweet, runDir: string): string {
  return `Hi Claude, please check if we should write a Community Note on this tweet. Do research on this and think about whether the tweet is misleading or broadly correct. In your system prompt, there are lots of examples of Community Notes that were rated helpful and Community Notes that were rated unhelpful. ${tweet.picks.claude_x_taste === WITH_THOUGHTS ? X_THOUGHTS : ""}You always need to provide at least one source, so you always need to do at least one web search (if you think a note is potentially needed).${tweet.picks.claude_x_research_nudge === "on" ? X_RESEARCH_NUDGE : ""}

If the post has images, download them into your run folder and look at them. Your run folder is ${runDir}; write every file there.

If the post needs a note, write ${runDir}/note.json as { "runId": "${tweet.runId}", "note": "<the note, with the links to its sources>", "reasoning": "<a few sentences on why the post needs it>" } and run \`bun run claude-notes x-note ${runDir}/note.json\`. A note has at most ${X_NOTE_MAX_CHARS} characters, where each link counts as one, and needs at least one link. If the post needs no note, run \`bun run claude-notes x-no-note ${tweet.runId} "<why>"\`. Stop once one of the two has succeeded.

The post, as our pipeline shows it:

${tweet.input}`;
}

function messagePrompt(params: { text: string; from: string; draft: unknown; url: string; dir: string; runDir: string }): string {
  return `A reviewer asked about one of the Claude note writer's notes on commonnotes.net. Answer them.

Their message: ${params.text}
From: ${params.from}
The draft, as JSON: ${JSON.stringify(params.draft)}
The post: ${params.url}
The post folder: ${params.dir} (it may be missing if the post was checked on another machine; then read the page itself)
Your run folder: ${params.runDir}

The examples in your system prompt are notes the reviewers judged. Research on the web when the question needs it. Then write a JSON file to your run folder and run \`bun run claude-notes answer <file>\`:

{ "draftId": "<draft id>", "reply": "<your answer, a few plain sentences>", "note": "<only if the note should change: the improved note text>", "sources": [<only with a new note whose sources changed: each { "url", "quote", "explanation" }, where you downloaded the page with curl and found the quote in it word for word with grep -F>], "reason": "<only with a new note: why it changed>" }

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
function startClaude(session: string, runDir: string, prompt: string, extraArgs: string[] = []) {
  writeFileSync(path.join(runDir, "prompt.md"), prompt);
  const script = [
    "set -a",
    `. ${ENV_FILE}`,
    "set +a",
    "unset SERVICE_AUTH_SECRET EXTRACTION_URL",
    `export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"`,
    `cd ${REPO}`,
    `"${CLAUDE_BIN}" -p "$(cat ${runDir}/prompt.md)" --model opus --permission-mode bypassPermissions --settings ${RUN_SETTINGS} ${extraArgs.join(" ")} --output-format stream-json --verbose > ${runDir}/stream.jsonl 2> ${runDir}/stderr.txt`,
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

/** What the run would have cost on the API, as Claude Code reports it in the
 *  last event of its output. xShare.ts splits the plan's usage by these costs.
 *  Null when the run died before it reported. */
function runCost(runDir: string): number | null {
  let lines: string[];
  try {
    lines = readFileSync(path.join(runDir, "stream.jsonl"), "utf8").trim().split("\n");
  } catch {
    return null;
  }
  for (const line of lines.reverse()) {
    try {
      const event = JSON.parse(line);
      if (event.type === "result" && typeof event.total_cost_usd === "number") return event.total_cost_usd;
    } catch {
      // A run killed mid-write leaves a cut-off last line.
    }
  }
  return null;
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
    await failPost(item, err as Error);
    return;
  }
  if (taken.kind === "skipped") return console.log(`Skipped ${item.url}: ${taken.reason}`);
  const session = POST_SESSION_PREFIX + item.id.slice(0, 8);
  startClaude(session, runDir, postPrompt(item, taken.dir, runDir, attempt === 1 ? drawPostPicks(runDir) : readPostPicks(runDir)), ["--append-system-prompt-file", EXAMPLES_PATH]);
  posts.set(item.id, { item, session, runDir, attempt, startedAt: Date.now(), weeklyAtStart: await weeklyUsage() });
  console.log(`Started ${session} on ${item.url} (attempt ${attempt})`);
}

/** A post's A/B picks live in its run folder. The first attempt draws them,
 *  and a retry reads them, so both attempts get the same prompt. */
const picksFile = (runDir: string) => path.join(runDir, "picks.json");

function drawPostPicks(runDir: string): Record<string, string> {
  const picks = { bot: CLAUDE_CODE_BOT, [CLAUDE_CN_TASTE_TEST.name]: pickVariantName(CLAUDE_CN_TASTE_TEST) };
  writeFileSync(picksFile(runDir), JSON.stringify(picks));
  return picks;
}

/** A post whose Claude started before the runner drew picks has no file. */
function readPostPicks(runDir: string): Record<string, string> {
  return existsSync(picksFile(runDir)) ? JSON.parse(readFileSync(picksFile(runDir), "utf8")) : { bot: CLAUDE_CODE_BOT };
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
  const usageNote = { weeklyAtStart: run.weeklyAtStart, weeklyAtEnd: await weeklyUsage(), minutes: Math.round((Date.now() - run.startedAt) / 60_000), attempt: run.attempt, costUsd: runCost(run.runDir) };
  console.log(`${run.session} ended after ${usageNote.minutes} minutes, ${report ? "with" : "without"} a report`);
  const record = (outcome: PostRunOutcome) => recordPostRun(run.item.id, outcome, readPostPicks(run.runDir), { runDir: run.runDir, report, ...usageNote });
  if (report?.skipped) {
    await record("skipped");
    return skipItem(run.item.id, String(report.reason ?? "nothing worth checking"));
  }
  if (report) {
    await record("done");
    return finishItem(run.item.id, { ...report, ...usageNote });
  }
  if (await savedDrafts(run)) {
    await record("incomplete");
    return finishItem(run.item.id, { incomplete: true, reason: `Claude exited without a report after saving drafts; see ${run.runDir}`, ...usageNote });
  }
  if (run.attempt < MAX_ATTEMPTS) return startPost(run.item, run.attempt + 1);
  await record("failed");
  await failPost(run.item, new Error(`Claude exited twice without a report; see ${run.runDir} on ai-box`));
}

/** Records a failed post on its row the way the pipeline does, so the walk
 *  tries it again after its rest time. The failure is also logged as an
 *  item_failed event, which turns the next feed run red. A young video
 *  without captions yet is the one expected failure, and it is not logged. */
async function failPost(item: QueueItem, err: Error) {
  console.log(`Failed on ${item.url}: ${err.message}`);
  const outcome = await recordItemFailure(await fetchItem(item.id), err);
  if (outcome === "error") await logEvent({ actor: "claude", type: "item_failed", itemId: item.id, data: { reason: err.message } });
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

// ---------------------------------------------------------------------------
// X tweets
// ---------------------------------------------------------------------------

async function startTweet(tweet: XTweet, attempt = 1) {
  const runDir = runFolder(`x-${tweet.runId}`);
  const session = TWEET_SESSION_PREFIX + tweet.runId.slice(0, 8);
  await markXTweetRunning(tweet.runId, attempt);
  startClaude(session, runDir, tweetPrompt(tweet, runDir), ["--append-system-prompt-file", X_EXAMPLES_PATH]);
  tweets.set(tweet.runId, { tweet, session, runDir, attempt, startedAt: Date.now(), weeklyAtStart: await weeklyUsage() });
  console.log(`Started ${session} on tweet ${tweet.tweetId} (attempt ${attempt})`);
}

/** A Claude that exited without a note or a no-note gets one more try. The
 *  stage guards in xTweets.ts make sure an answer is never saved twice. */
async function endTweet(run: Run & { tweet: XTweet }) {
  tweets.delete(run.tweet.runId);
  const minutes = Math.round((Date.now() - run.startedAt) / 60_000);
  await recordXTweetRun(run.tweet.runId, { costUsd: runCost(run.runDir), minutes });
  console.log(`${run.session} ended after ${minutes} minutes`);
  if (!(await xTweetIsOpen(run.tweet.runId))) return;
  if (run.attempt < MAX_ATTEMPTS) return startTweet(run.tweet, run.attempt + 1);
  await failXTweet(run.tweet.runId, `The Claude note writer exited twice without an answer; see ${run.runDir} on ai-box`);
}

/** After a restart, a tweet whose Claude still runs is adopted, and one that
 *  lost its Claude is started again. */
async function adoptRunningTweets(running: XTweet[]) {
  for (const tweet of running) {
    const session = TWEET_SESSION_PREFIX + tweet.runId.slice(0, 8);
    if (tmuxAlive(session)) tweets.set(tweet.runId, { tweet, session, runDir: runFolder(`x-${tweet.runId}`), attempt: 1, startedAt: Date.now(), weeklyAtStart: null });
    else await startTweet(tweet);
  }
}

/** X tweets run whatever the Common Notes writer setting says, because the X
 *  run already decided that they go to Claude. */
async function tickTweets(first: boolean) {
  for (const run of [...tweets.values()]) if (!tmuxAlive(run.session)) await endTweet(run);
  const open = await openXTweets();
  if (first) await adoptRunningTweets(open.running);
  for (const tweet of open.waiting) {
    if (tweets.size >= MAX_TWEETS_RUNNING || !(await mayStartPosts())) break;
    await startTweet(tweet);
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
  startClaude(session, runDir, messagePrompt({ ...message, draft: { id: draftId, passage, note, sources, reasoning, outcome, status }, url: item.url, dir: postDir(item.url), runDir }), ["--append-system-prompt-file", EXAMPLES_PATH]);
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
    const examples = examplesForJudge.filter((e) => e.draftId !== draftId);
    const judgement = await runJudge(runFolder(`judge/${draftId}-${Date.now()}`), judgePrompt(note, examples));
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
  await tickTweets(first);
  await judgeNotes(first);
  if ((await readSettings()).writer !== "claude") return;
  if (!existsSync(PAUSE_FILE)) await startAnswers();
  const queue = await claudeQueue();
  if (first) await adoptTakenPosts(queue.taken);
  for (const item of queue.waiting) {
    if (posts.size >= MAX_POSTS_RUNNING || !(await mayStartPosts())) break;
    await startPost(item);
  }
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
