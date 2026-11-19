/* The Claude note writer's runner (GOO-580). It runs all the time on Nathan's
 * ai-box as a systemd service, under Nathan's user. Since GOO-787 its Claudes
 * run on Jim's notewriter account, whose login is in its own config folder:
 * the unit file sets CLAUDE_CONFIG_DIR, and every Claude the runner starts
 * gets it too. Nathan's own login in his home folder is not used. Without the
 * variable, Claude Code uses the login in the home folder, as on hq.
 * It is the notewriter claude-ai-box. Since GOO-787 it calls API v2 of the
 * notewriters with its own key (CN_NOTEWRITER_KEY, see
 * src/claude-notes/queue.ts); without a key a host uses API v1, as hq does.
 * It reserves a post whenever it has a free slot, starts one Claude for each
 * post it gets, and finishes the post when that Claude is done. A post it
 * cannot finish it fails on, so the post stays for the other notewriters.
 * Every 5 minutes it turns the plan's usage into its pace: how often it wants
 * a feed post, and whether it takes reader requests. The same code runs on hq
 * as claude-hq-nathan.
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
import { claudeEnded, problemCleared, problemStarted, tellSlack } from "./alerts";
import {
  beginPost,
  beginTweet,
  claudeFailure,
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
  stopAtPercent,
  updateClaudeSubscription,
  waitingMessages,
} from "./jobs";
import { guardedSettingsFile } from "./imageGuard";
import { claudeQueue } from "./queue";
import { EXAMPLES_PATH, messagePrompt, postPrompt, REPO, tweetPrompt, X_EXAMPLES_PATH, xAccountPrompt } from "./prompts";
import { recordUsage, RUN_ID_ENV } from "./store";
import { readUsage, type UsageReading } from "./usage";
import { creatorsToLookUp, type CreatorToLookUp } from "./xAccounts";
import { screenImages } from "./imageScreen";
import { failXTweet, openXTweets, type XTweet } from "./xTweets";
import { CLAUDE_TWEET_MAX_WAIT_MINUTES } from "../pipeline/orchestration/claudeTweets";

const POLL_MS = 30_000;
/** Posts in progress at once. The queue hands out reader requests first, so a
 *  request takes the next free slot. The queue spaces Claude's feed posts by
 *  its subscription, which follows the weekly usage
 *  (src/everything/usagePacing.ts), so this limit is rarely reached. */
const MAX_POSTS_RUNNING = 5;
/** X tweets in progress at once, on top of the posts. The X share of the week
 *  (src/claude-notes/xShare.ts) decides how many tweets come; this only stops
 *  a burst from one X run from starting all its tweets at the same moment.
 *  About 180 tweets a day draw Claude since GOO-787, so 6 at a time keep up. */
const MAX_TWEETS_RUNNING = 6;
/** The usage endpoint is rate limited, and Nathan's pacer reads it too. */
const USAGE_READ_EVERY_MS = 5 * 60_000;

const PAUSE_FILE = process.env.CN_PAUSE_FILE ?? "/srv/ai-box/PAUSE";
/** The deploy's freeze (ops/ai-box/deploy.sh). While this file exists the
 *  runner starts no Claude, and the work that comes in waits in the database.
 *  Once nothing is at work any more, the deploy updates the code, removes the
 *  file and restarts the runner, which then starts the waiting work. */
const DRAIN_FILE = process.env.CN_DRAIN_FILE ?? "/var/lib/cn-notes-deploy/draining";
/** A tweet with less time than this before the X run sweeps it is not
 *  started: its Claude would be stopped before it could answer. */
const MIN_TIME_TO_START_TWEET_MS = 20 * 60_000;
const RUN_SETTINGS = process.env.CN_RUN_SETTINGS ?? "/srv/ai-box/run-settings.json";
const ENV_FILE = process.env.CN_ENV_FILE ?? "/etc/cn-notes/env";
const CLAUDE_BIN = process.env.CN_CLAUDE_BIN ?? path.join(homedir(), ".local/bin/claude");
/** The config folder of the notewriter's Claude account, or undefined for the
 *  login in the home folder. */
const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
/** Jim asked for high effort on 2026-11-15, when the note writers ran as
 *  subagents on the devbox. The judge sets its own model and effort. */
const CLAUDE_EFFORT = "high";
/** On the main disk. /tmp on ai-box is a small tmpfs in memory with a quota per
 *  user, and a day of run folders is more than a gigabyte, which filled the
 *  quota on 2026-10-30 and crashed the runner. */
const RUNS_DIR = process.env.CN_RUNS_DIR ?? "/var/tmp/cn-notes";
/** What the runner is doing, written on every round for the deploy to read:
 *  plain lines of name=value, so the deploy never runs anything from it. */
const RUNNER_STATE_FILE = path.join(RUNS_DIR, "runner-state");
/** A second runner on another Claude plan (CN_POSTS_ONLY=1, with its own
 *  CN_NOTEWRITER) writes Common Notes posts and nothing else: X tweets,
 *  reviewer answers, X account lookups and the judge stay with claude-ai-box.
 *  Its plan's readings stay out of the shared usage table, whose pacing is
 *  claude-ai-box's. */
const POSTS_ONLY = process.env.CN_POSTS_ONLY === "1";
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

/** One Claude session of the runner. `stopAt` is when the runner stops it if
 *  it is still at work, and `timedOut` says that it did. */
type Run = { session: string; runDir: string; attempt: number; startedAt: number; weeklyAtStart: number | null; stopAt: number; timedOut?: boolean };

/** A Claude is stopped this long before the job's own deadline, so the runner
 *  still has time to save what it did and end the job itself. Without it, a
 *  post whose Claude outlived its reservation could no longer be finished. */
const STOP_BEFORE_DEADLINE_MS = 10 * 60_000;
/** Reviewer answers and X handle lookups have no deadline of their own. A
 *  Claude that works on one for this long is stuck. */
const SMALL_JOB_MAX_MS = 60 * 60_000;
/** A post's Claude must stop before its reservation ends. */
const postStopAt = (post: HeldPost) => Date.parse(post.deadline) - STOP_BEFORE_DEADLINE_MS;
/** A tweet's Claude must stop before the X run sweeps the tweet as failed. */
const tweetStopAt = (tweet: XTweet) => Date.parse(tweet.createdAt) + CLAUDE_TWEET_MAX_WAIT_MINUTES * 60_000 - STOP_BEFORE_DEADLINE_MS;

/** Stops a Claude that is still at work at its stop time. The next round of
 *  the loop sees its session gone and closes the job without another try. */
function stopIfOverdue(run: Run) {
  if (Date.now() < run.stopAt || !tmuxAlive(run.session)) return;
  spawnSync("tmux", ["kill-session", "-t", `=${run.session}`]);
  run.timedOut = true;
  console.error(`Stopped ${run.session}: it was still at work ${Math.round((Date.now() - run.startedAt) / 60_000)} minutes after it started, at its time limit`);
}

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
const judge = noteJudge({ runFolder, mayStart: mayStartClaudes, claudeEnded });

// ---------------------------------------------------------------------------
// Claude sessions
// ---------------------------------------------------------------------------

const tmuxAlive = (session: string) => spawnSync("tmux", ["has-session", "-t", `=${session}`]).status === 0;

/** Starts `claude -p` in a detached tmux session. The secrets come from the
 *  env file inside the session, so they never appear in a process's
 *  arguments. The service secret is removed again, because the agents never
 *  call the services box; only `take` in this runner does. So are the Slack
 *  and OpenAI keys, which only the runner's alerts and image screen use, and
 *  the notewriter key, with which only the runner reserves posts. The script sets
 *  CLAUDE_CONFIG_DIR itself, because a tmux session takes its environment from
 *  the tmux server, which may have started long before this runner. */
function startClaude(session: string, runDir: string, prompt: string, extraArgs: string[] = [], env: Record<string, string> = {}) {
  const account = CLAUDE_CONFIG_DIR ? { CLAUDE_CONFIG_DIR } : {};
  writeFileSync(path.join(runDir, "prompt.md"), prompt);
  const script = [
    "set -a",
    `. ${ENV_FILE}`,
    "set +a",
    "unset SERVICE_AUTH_SECRET EXTRACTION_URL SLACK_BOT_TOKEN OPENAI_API_KEY CN_NOTEWRITER_KEY",
    ...Object.entries({ ...account, ...env }).map(([name, value]) => `export ${name}=${value}`),
    `export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"`,
    `cd ${REPO}`,
    `"${CLAUDE_BIN}" -p "$(cat ${runDir}/prompt.md)" --model opus --effort ${CLAUDE_EFFORT} --permission-mode bypassPermissions --settings ${guardedSettingsFile(runDir, RUN_SETTINGS)} ${extraArgs.join(" ")} --output-format stream-json --verbose > ${runDir}/stream.jsonl 2> ${runDir}/stderr.txt`,
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
// Usage of the notewriter's plan
// ---------------------------------------------------------------------------

/** Claude Code renews its login token only when it runs. While no post runs,
 *  the token in the credentials file expires, and the usage endpoint answers
 *  401. A tiny Claude call renews the token. */
function renewClaudeLogin() {
  const renewed = spawnSync(CLAUDE_BIN, ["-p", "Reply with OK", "--model", "haiku"], { cwd: RUNS_DIR, encoding: "utf8", timeout: 120_000 });
  console.log(renewed.status === 0 ? "Renewed the Claude login" : `Could not renew the Claude login: ${renewed.stderr}`);
}

const isUnauthorized = (err: unknown) => (err as Error).message.includes(" 401");

async function readUsageRenewingLogin(): Promise<UsageReading> {
  try {
    return await readUsage();
  } catch (err) {
    if (!isUnauthorized(err)) throw err;
    renewClaudeLogin();
    return readUsage();
  }
}

/** Slack hears of a usage endpoint that fails for this long. Without a
 *  reading the runner starts nothing. */
const USAGE_ALERT_AFTER_MS = 30 * 60_000;
let usageGoodAt = Date.now();

/** Tells Slack when the login is dead or the usage cannot be read, and again
 *  when it works again. */
async function alertAboutUsage(err: unknown) {
  if (err === null) {
    usageGoodAt = Date.now();
    await problemCleared("login", "The Claude login works again.");
    return problemCleared("usage", "The usage of the Claude plan can be read again.");
  }
  if (isUnauthorized(err)) {
    return problemStarted("login", "The Claude login no longer works, even after a renewal, so the runner starts no Claude. Someone has to log in again (ops/ai-box/README.md).");
  }
  if (Date.now() - usageGoodAt > USAGE_ALERT_AFTER_MS) {
    await problemStarted("usage", `The runner has not read the usage of its Claude plan for 30 minutes, so it starts no Claude. The last error: ${(err as Error).message}`);
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
      if (!POSTS_ONLY) await recordUsage(usage);
      await alertAboutUsage(null);
    } catch (err) {
      console.error(`Could not read the usage: ${(err as Error).message}`);
      await alertAboutUsage(err);
    }
    await updateClaudeSubscription(usage?.weekly ?? null, existsSync(PAUSE_FILE));
  }
  return usage?.weekly ?? null;
}

async function mayStartClaudes(): Promise<boolean> {
  if (existsSync(PAUSE_FILE) || existsSync(DRAIN_FILE)) return false;
  const weekly = await weeklyUsage();
  return weekly !== null && weekly < stopAtPercent();
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

/** Closes a Claude session's books: counts it for the failure alert and
 *  reports what it cost. */
async function ended(run: Run): Promise<JobEnd> {
  await claudeEnded(run.timedOut ? `${run.session} was stopped at its time limit` : claudeFailure(run.runDir));
  return { weeklyAtEnd: await weeklyUsage(), apiCostUsd: runCost(run.runDir), timedOut: run.timedOut === true };
}

async function startPost(post: HeldPost, attempt = 1) {
  const { item } = post;
  const runDir = runFolder(item.id);
  console.log(`Taking ${item.url}`);
  const start = await beginPost(post, runDir, attempt);
  if (start.kind !== "ready") return;
  const session = POST_SESSION_PREFIX + item.id.slice(0, 8);
  const { postRun } = start;
  startClaude(session, runDir, postPrompt({ item, dir: start.dir, runDir, picks: postRun.picks, asked: start.asked }), ["--append-system-prompt-file", EXAMPLES_PATH], { [RUN_ID_ENV]: postRun.runId });
  posts.set(item.id, { ...post, session, runDir, attempt, startedAt: Date.now(), weeklyAtStart: await weeklyUsage(), stopAt: postStopAt(post) });
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
    const run = { ...post, session, runDir, attempt: 1, startedAt, weeklyAtStart: null, stopAt: postStopAt(post) };
    if (tmuxAlive(session)) posts.set(item.id, run);
    else if (readReport(runDir)) await endPostSession(run);
    else await startPost(post);
  }
}

// ---------------------------------------------------------------------------
// X tweets
// ---------------------------------------------------------------------------

/** Whether the tweet's images passed the image screen (GOO-815). A tweet
 *  they did not pass fails, and Slack hears of it. */
async function tweetPassesScreen(tweet: XTweet): Promise<boolean> {
  try {
    const screen = await screenImages(tweet.input);
    if (screen.kind === "clear") return true;
    await failXTweet(tweet.runId, `The image screen flagged an image (sexual score ${screen.sexualScore.toFixed(2)}), so no Claude saw this tweet`, "image_flagged");
    await tellSlack(`The image screen stopped X tweet run ${tweet.runId}: one of its images scored ${screen.sexualScore.toFixed(2)} for sexual content. No Claude saw it.`);
  } catch (err) {
    await failXTweet(tweet.runId, `The image screen could not run: ${(err as Error).message}`, "image_screen_failed");
    await claudeEnded(`The image screen on X tweet run ${tweet.runId}: ${(err as Error).message}`);
  }
  return false;
}

async function startTweet(tweet: XTweet, attempt = 1) {
  if (attempt === 1 && !(await tweetPassesScreen(tweet))) return;
  const runDir = runFolder(`x-${tweet.runId}`);
  const session = TWEET_SESSION_PREFIX + tweet.runId.slice(0, 8);
  await beginTweet(tweet, attempt);
  startClaude(session, runDir, tweetPrompt({ tweet, runDir }), ["--append-system-prompt-file", X_EXAMPLES_PATH]);
  tweets.set(tweet.runId, { tweet, session, runDir, attempt, startedAt: Date.now(), weeklyAtStart: await weeklyUsage(), stopAt: tweetStopAt(tweet) });
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
    if (tmuxAlive(session)) tweets.set(tweet.runId, { tweet, session, runDir: runFolder(`x-${tweet.runId}`), attempt: 1, startedAt: Date.now(), weeklyAtStart: null, stopAt: tweetStopAt(tweet) });
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
    if (tweets.size >= MAX_TWEETS_RUNNING || !(await mayStartClaudes())) break;
    if (tweetStopAt(tweet) - Date.now() < MIN_TIME_TO_START_TWEET_MS) continue;
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
  startClaude(session, runDir, messagePrompt({ ...message, ...(await messageContext(draftId)), runDir }), ["--append-system-prompt-file", EXAMPLES_PATH]);
  answers.set(draftId, { session, runDir, attempt, startedAt: Date.now(), weeklyAtStart: null, stopAt: Date.now() + SMALL_JOB_MAX_MS });
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
  xAccountLookups.set(creator.slug, { creator, session, runDir, attempt, startedAt: Date.now(), weeklyAtStart: await weeklyUsage(), stopAt: Date.now() + SMALL_JOB_MAX_MS });
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
  if (xAccountLookups.size >= MAX_X_ACCOUNT_LOOKUPS_RUNNING || !(await mayStartClaudes())) return;
  const next = (await creatorsToLookUp()).find((c) => !xAccountLookups.has(c.slug) && !xAccountsGivenUp.has(c.slug));
  if (next) await startXAccountLookup(next, 1);
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

async function tick(first: boolean) {
  // On API v2 any call is the sign of life that cn-walk's silence watch looks
  // for. On v1 the subscription every 5 minutes is.
  await claudeQueue().signOfLife();
  await weeklyUsage();
  for (const run of [...posts.values(), ...tweets.values(), ...answers.values(), ...xAccountLookups.values()]) stopIfOverdue(run);
  for (const run of [...posts.values()]) if (!tmuxAlive(run.session)) await endPostSession(run);
  if (!POSTS_ONLY) {
    await endAnswers();
    await tickTweets(first);
    await tickXAccounts();
    await judge.tick(first);
    if (!existsSync(PAUSE_FILE) && !existsSync(DRAIN_FILE)) await startAnswers();
  }
  if (first) await adoptHeldPosts(await heldClaudePosts());
  while (posts.size < MAX_POSTS_RUNNING && (await mayStartClaudes())) {
    const post = await nextClaudePost();
    if (!post) break;
    await startPost(post);
  }
  writeRunnerState();
}

/** Tells the deploy whether the freeze has taken hold: the runner saw the
 *  drain file and no Claude of it is at work, judges included. */
function writeRunnerState() {
  const running = posts.size + tweets.size + answers.size + xAccountLookups.size + judge.running();
  const lines = [`at=${Math.floor(Date.now() / 1000)}`, `draining=${existsSync(DRAIN_FILE) ? 1 : 0}`, `running=${running}`];
  writeFileSync(RUNNER_STATE_FILE, `${lines.join("\n")}\n`);
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
