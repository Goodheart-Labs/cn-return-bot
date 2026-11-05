/* The Claude note writer's runner (GOO-580). It runs all the time on Nathan's
 * ai-box as a systemd service, under Nathan's user, because Claude Code uses
 * the login in his home folder. It is the notewriter claude-ai-box of the
 * notewriter protocol (GOO-724, src/notewriters/): it asks the queue for a
 * post whenever it has a free slot, starts one Claude for each post it gets,
 * and finishes the post when that Claude is done. A post it cannot finish it
 * fails on, so the queue gives it to another notewriter and the feed run goes
 * red. Every 5 minutes it turns the plan's usage into its subscription: how
 * often it wants a feed post, and whether it takes reader requests.
 * It also starts one Claude for each reviewer message on the review page, and
 * one Claude for each X tweet the X run handed to it (GOO-527, see
 * src/pipeline/orchestration/claudeTweets.ts). And it runs the note judge on
 * every note as soon as it is posted (GOO-591), whose two probabilities the
 * review page shows. And it starts one Claude for each creator with a Claude
 * note whose X account nobody has looked up yet (GOO-639).
 *
 * Every Claude runs in its own tmux session, so a person can attach and watch
 * it. Its files are in its run folder under /var/tmp/cn-notes, a tmp folder
 * Nathan's guard hook lets unattended runs write to, on the box's main disk.
 *
 * Usage: bun run claude-notes run */

import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import * as path from "path";
import {
  beginPost,
  beginTweet,
  endAnswer,
  endPost,
  endTweet,
  endXAccountLookup,
  heldClaudePosts,
  type HeldPost,
  type JobEnd,
  messageContext,
  nextClaudePost,
  noteJudge,
  readReport,
  refreshExamples,
  type ReviewerMessage,
  runCost,
  updateClaudeSubscription,
  waitingMessages,
} from "./jobs";
import { EXAMPLES_PATH, messagePrompt, postPrompt, REPO, tweetPrompt, X_EXAMPLES_PATH, xAccountPrompt } from "./prompts";
import { recordUsage, RUN_ID_ENV } from "./store";
import { readUsage, type UsageReading } from "./usage";
import { MAX_WEEKLY_USAGE_PERCENT } from "../everything/usagePacing";
import { creatorsToLookUp, type CreatorToLookUp } from "./xAccounts";
import { openXTweets, type XTweet } from "./xTweets";

const POLL_MS = 30_000;
/** Posts in progress at once. The queue hands out reader requests first, so a
 *  request takes the next free slot. The queue spaces Claude's feed posts by
 *  its subscription, which follows the weekly usage
 *  (src/everything/usagePacing.ts), so this limit is rarely reached. */
const MAX_POSTS_RUNNING = 5;
/** X tweets in progress at once, on top of the posts. The X share of the week
 *  (src/claude-notes/xShare.ts) decides how many tweets come; this only stops
 *  a burst from one X run from starting all its tweets at the same moment. */
const MAX_TWEETS_RUNNING = 3;
/** The usage endpoint is rate limited, and Nathan's pacer reads it too. */
const USAGE_READ_EVERY_MS = 5 * 60_000;

const PAUSE_FILE = process.env.CN_PAUSE_FILE ?? "/srv/ai-box/PAUSE";
const RUN_SETTINGS = process.env.CN_RUN_SETTINGS ?? "/srv/ai-box/run-settings.json";
const ENV_FILE = process.env.CN_ENV_FILE ?? "/etc/cn-notes/env";
const CLAUDE_BIN = process.env.CN_CLAUDE_BIN ?? path.join(homedir(), ".local/bin/claude");
/** On the main disk. /tmp on ai-box is a small tmpfs in memory with a quota per
 *  user, and a day of run folders is more than a gigabyte, which filled the
 *  quota on 2026-10-30 and crashed the runner. */
const RUNS_DIR = "/var/tmp/cn-notes";
/** Run folders older than this are deleted. By then their post is finished
 *  and everything that matters is in the database. */
const KEEP_RUN_FOLDERS_MS = 3 * 24 * 3600_000;
const PRUNE_EVERY_MS = 24 * 3600_000;
const POST_SESSION_PREFIX = "cn-post-";
const MESSAGE_SESSION_PREFIX = "cn-msg-";
const TWEET_SESSION_PREFIX = "cn-x-";
const X_ACCOUNT_SESSION_PREFIX = "cn-xacct-";
/** X account lookups at once. They are small, so one at a time keeps them
 *  from crowding out posts. */
const MAX_X_ACCOUNT_LOOKUPS_RUNNING = 1;

type Run = { session: string; runDir: string; attempt: number; startedAt: number; weeklyAtStart: number | null };

const posts = new Map<string, Run & HeldPost>();
const tweets = new Map<string, Run & { tweet: XTweet }>();
const answers = new Map<string, Run>();
const xAccountLookups = new Map<string, Run & { creator: CreatorToLookUp }>();
/** Drafts whose message Claude failed to answer twice, and creators whose X
 *  account two Claudes could not settle. They wait for a person or a restart. */
const unanswerable = new Set<string>();
const xAccountsGivenUp = new Set<string>();
let usage: UsageReading | null = null;
let usageReadAt = 0;
const judge = noteJudge({ runFolder, mayStart: mayStartPosts });

// ---------------------------------------------------------------------------
// Claude sessions
// ---------------------------------------------------------------------------

const tmuxAlive = (session: string) => spawnSync("tmux", ["has-session", "-t", `=${session}`]).status === 0;

/** Starts `claude -p` in a detached tmux session. The secrets come from the
 *  env file inside the session, so they never appear in a process's
 *  arguments. The service secret is removed again, because the agents never
 *  call the services box; only `take` in this runner does. */
function startClaude(session: string, runDir: string, prompt: string, extraArgs: string[] = [], env: Record<string, string> = {}) {
  writeFileSync(path.join(runDir, "prompt.md"), prompt);
  const script = [
    "set -a",
    `. ${ENV_FILE}`,
    "set +a",
    "unset SERVICE_AUTH_SECRET EXTRACTION_URL",
    ...Object.entries(env).map(([name, value]) => `export ${name}=${value}`),
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

// ---------------------------------------------------------------------------
// Usage of Nathan's plan
// ---------------------------------------------------------------------------

/** Claude Code renews its login token only when it runs. While no post runs,
 *  the token in the credentials file expires, and the usage endpoint answers
 *  401. A tiny Claude call renews the token. */
function renewClaudeLogin() {
  const renewed = spawnSync(CLAUDE_BIN, ["-p", "Reply with OK", "--model", "haiku"], { cwd: RUNS_DIR, encoding: "utf8", timeout: 120_000 });
  console.log(renewed.status === 0 ? "Renewed the Claude login" : `Could not renew the Claude login: ${renewed.stderr}`);
}

async function readUsageRenewingLogin(): Promise<UsageReading> {
  try {
    return await readUsage();
  } catch (err) {
    if (!(err as Error).message.includes(" 401")) throw err;
    renewClaudeLogin();
    return readUsage();
  }
}

/** The latest reading, at most 5 minutes old. Each new reading is stored for
 *  the admin dashboard's usage chart and turned into Claude's subscription. A
 *  failed read keeps the last one, and with no reading at all no post starts. */
async function weeklyUsage(): Promise<number | null> {
  if (Date.now() - usageReadAt > USAGE_READ_EVERY_MS) {
    usageReadAt = Date.now();
    try {
      usage = await readUsageRenewingLogin();
      await recordUsage(usage);
    } catch (err) {
      console.error(`Could not read the usage: ${(err as Error).message}`);
    }
    await updateClaudeSubscription(usage?.weekly ?? null, existsSync(PAUSE_FILE));
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

const ended = async (run: Run): Promise<JobEnd> => ({ weeklyAtEnd: await weeklyUsage(), apiCostUsd: runCost(run.runDir) });

async function startPost(post: HeldPost, attempt = 1) {
  const { item } = post;
  const runDir = runFolder(item.id);
  console.log(`Taking ${item.url}`);
  const start = await beginPost(post, runDir, attempt);
  if (start.kind !== "ready") return;
  const session = POST_SESSION_PREFIX + item.id.slice(0, 8);
  const { postRun } = start;
  startClaude(session, runDir, postPrompt({ host: "ai-box", item, dir: start.dir, runDir, runId: postRun.runId, picks: postRun.picks, asked: start.asked }), ["--append-system-prompt-file", EXAMPLES_PATH], { [RUN_ID_ENV]: postRun.runId });
  posts.set(item.id, { ...post, session, runDir, attempt, startedAt: Date.now(), weeklyAtStart: await weeklyUsage() });
  console.log(`Started ${session} on ${item.url} (attempt ${attempt})`);
}

async function endPostSession(run: Run & HeldPost) {
  posts.delete(run.item.id);
  if ((await endPost(run, await ended(run))) === "retry") await startPost(run, run.attempt + 1);
}

/** After a restart, a post Claude still holds is in one of three states.
 *  Its Claude is still running, and the runner adopts it. Its Claude finished
 *  and wrote a report, but the runner died before it marked the item done; the
 *  runner finishes it from that report, because running it again would post
 *  its notes a second time. Or its Claude died without a report, and the post
 *  is taken again. */
async function adoptHeldPosts(held: HeldPost[]) {
  for (const post of held) {
    const { item } = post;
    const session = POST_SESSION_PREFIX + item.id.slice(0, 8);
    const runDir = runFolder(item.id);
    // The prompt file is written when the post's Claude starts.
    const promptFile = path.join(runDir, "prompt.md");
    const startedAt = existsSync(promptFile) ? statSync(promptFile).mtimeMs : Date.now();
    const run = { ...post, session, runDir, attempt: 1, startedAt, weeklyAtStart: null };
    if (tmuxAlive(session)) posts.set(item.id, run);
    else if (readReport(runDir)) await endPostSession(run);
    else await startPost(post);
  }
}

// ---------------------------------------------------------------------------
// X tweets
// ---------------------------------------------------------------------------

async function startTweet(tweet: XTweet, attempt = 1) {
  const runDir = runFolder(`x-${tweet.runId}`);
  const session = TWEET_SESSION_PREFIX + tweet.runId.slice(0, 8);
  await beginTweet(tweet, attempt);
  startClaude(session, runDir, tweetPrompt({ host: "ai-box", tweet, runDir }), ["--append-system-prompt-file", X_EXAMPLES_PATH]);
  tweets.set(tweet.runId, { tweet, session, runDir, attempt, startedAt: Date.now(), weeklyAtStart: await weeklyUsage() });
  console.log(`Started ${session} on tweet ${tweet.tweetId} (attempt ${attempt})`);
}

async function endTweetSession(run: Run & { tweet: XTweet }) {
  tweets.delete(run.tweet.runId);
  if ((await endTweet(run, await ended(run))) === "retry") await startTweet(run.tweet, run.attempt + 1);
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

/** X tweets are not part of Claude's subscription, because the X run already
 *  decided that they go to Claude. */
async function tickTweets(first: boolean) {
  for (const run of [...tweets.values()]) if (!tmuxAlive(run.session)) await endTweetSession(run);
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
  for (const [draftId, message] of await waitingMessages()) {
    if (answers.has(draftId) || unanswerable.has(draftId)) continue;
    await startAnswer(draftId, message, 1);
  }
}

async function startAnswer(draftId: string, message: ReviewerMessage, attempt: number) {
  const runDir = runFolder(`message-${draftId}-${Date.now()}`);
  const session = MESSAGE_SESSION_PREFIX + draftId.slice(0, 8);
  startClaude(session, runDir, messagePrompt({ host: "ai-box", ...message, ...(await messageContext(draftId)), runDir }), ["--append-system-prompt-file", EXAMPLES_PATH]);
  answers.set(draftId, { session, runDir, attempt, startedAt: Date.now(), weeklyAtStart: null });
  console.log(`Started ${session} to answer ${message.from} on draft ${draftId}`);
}

/** A message Claude did not answer gets one more try, then waits for a person. */
async function endAnswers() {
  for (const [draftId, run] of answers) {
    if (tmuxAlive(run.session)) continue;
    answers.delete(draftId);
    const outcome = await endAnswer(draftId, run, await ended(run));
    if (outcome === "gave_up") unanswerable.add(draftId);
    if (outcome !== "retry") continue;
    const message = (await waitingMessages()).get(draftId);
    if (message) await startAnswer(draftId, message, run.attempt + 1);
  }
}

// ---------------------------------------------------------------------------
// Creators' X accounts
// ---------------------------------------------------------------------------

async function startXAccountLookup(creator: CreatorToLookUp, attempt: number) {
  const runDir = runFolder(`xacct-${creator.slug}-${Date.now()}`);
  const session = X_ACCOUNT_SESSION_PREFIX + creator.slug.slice(0, 20);
  startClaude(session, runDir, xAccountPrompt({ creator, runDir }));
  xAccountLookups.set(creator.slug, { creator, session, runDir, attempt, startedAt: Date.now(), weeklyAtStart: await weeklyUsage() });
  console.log(`Started ${session} to find the X account of ${creator.name} (attempt ${attempt})`);
}

/** Closes the lookups that ended, then starts one for the next creator nobody
 *  has looked up, while the plan allows Claude runs. A creator whose X account
 *  is saved drops out of the list by itself. */
async function tickXAccounts() {
  for (const [slug, run] of xAccountLookups) {
    if (tmuxAlive(run.session)) continue;
    xAccountLookups.delete(slug);
    const outcome = await endXAccountLookup(run, await ended(run));
    if (outcome === "gave_up") xAccountsGivenUp.add(slug);
    if (outcome === "retry") await startXAccountLookup(run.creator, run.attempt + 1);
  }
  if (xAccountLookups.size >= MAX_X_ACCOUNT_LOOKUPS_RUNNING || !(await mayStartPosts())) return;
  const next = (await creatorsToLookUp()).find((c) => !xAccountLookups.has(c.slug) && !xAccountsGivenUp.has(c.slug));
  if (next) await startXAccountLookup(next, 1);
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

async function tick(first: boolean) {
  await weeklyUsage();
  for (const run of [...posts.values()]) if (!tmuxAlive(run.session)) await endPostSession(run);
  await endAnswers();
  await tickTweets(first);
  await tickXAccounts();
  await judge.tick(first);
  if (!existsSync(PAUSE_FILE)) await startAnswers();
  if (first) await adoptHeldPosts(await heldClaudePosts());
  while (posts.size < MAX_POSTS_RUNNING && (await mayStartPosts())) {
    const post = await nextClaudePost();
    if (!post) break;
    await startPost(post);
  }
}

let prunedAt = 0;

/** Deletes run folders not touched for three days, once a day. */
function pruneRunFolders() {
  if (Date.now() - prunedAt < PRUNE_EVERY_MS) return;
  prunedAt = Date.now();
  const cutoff = Date.now() - KEEP_RUN_FOLDERS_MS;
  const old = readdirSync(RUNS_DIR)
    .map((name) => path.join(RUNS_DIR, name))
    .filter((dir) => statSync(dir).mtimeMs < cutoff);
  for (const dir of old) rmSync(dir, { recursive: true, force: true });
  if (old.length > 0) console.log(`Deleted ${old.length} run folders older than 3 days`);
}

async function main() {
  mkdirSync(RUNS_DIR, { recursive: true });
  console.log(`Claude note writer runner started in ${REPO}`);
  for (let first = true; ; first = false) {
    refreshExamples(EXAMPLES_PATH);
    pruneRunFolders();
    await tick(first);
    await Bun.sleep(POLL_MS);
  }
}

await main();
