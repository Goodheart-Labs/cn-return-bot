/* The note writer's dispatcher on the devbox. While the runner on Nathan's
 * ai-box is down, the permanent Claude session on the devbox does its work,
 * on Jim's plan. The dispatcher does the runner's bookkeeping (jobs.ts) and
 * hands every job to that session, which starts one ordinary subagent per
 * job with the job's prompt. A job is a queued post, an X tweet the X run
 * handed to Claude, a reviewer message on the review page, or a creator whose
 * X account nobody has looked up yet.
 *
 * `dispatch` runs as a background task of the session. It waits until jobs
 * are ready, starts them, prints them and exits, and the end of the task
 * wakes the session up. It also exits every few hours without jobs, so the
 * session posts its digest. When a subagent has returned, the session runs
 * `dispatch-end` for its job, which closes the job or prints the prompt of
 * one more try. `dispatch-services` runs all the time next to it: it runs the
 * note judge and rebuilds the examples once a day, the way the runner does.
 *
 * `dispatch` also reads the plan's usage every 5 minutes while it waits. The
 * feed run and the X run take a reading older than 30 minutes to mean that
 * no Claude takes their work. The session starts `dispatch` again after every
 * wake, so the readings stop soon after the session stops answering. In
 * dispatch-services they would go on while the session is dead.
 *
 * The open jobs are kept in a file, so they survive a restart of the session.
 *
 * Usage: bun run claude-notes dispatch | dispatch-end <job key> | dispatch-services */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import * as path from "path";
import {
  beginPost,
  beginTweet,
  endAnswer,
  endPost,
  endTweet,
  endXAccountLookup,
  type JobEnd,
  type JobRun,
  messageContext,
  noteJudge,
  refreshExamples,
  type ReviewerMessage,
  waitingMessages,
} from "./jobs";
import { DEVBOX_EXAMPLES_PATH, messagePrompt, postPrompt, tweetPrompt, xAccountPrompt } from "./prompts";
import { claudeQueue, claudeRunsSince, type QueueItem, readSettings, recordUsage } from "./store";
import { CLAUDE_RUN_TAGS } from "./usageShare";
import { readUsage } from "./usage";
import { creatorsToLookUp, type CreatorToLookUp } from "./xAccounts";
import { openXTweets, type XTweet } from "./xTweets";

const STATE_DIR = path.join(homedir(), ".local/share/claude-note-finder/dispatch");
const JOBS_FILE = path.join(STATE_DIR, "jobs.json");
/** When `dispatch` last read the usage. `dispatch` starts again after every
 *  wake, so the time is kept in a file. */
const USAGE_READ_AT_FILE = path.join(STATE_DIR, "usage-read-at");
const RUNS_DIR = path.join(STATE_DIR, "runs");
/** The devbox's judges run without the ai-box guard hook. */
const JUDGE_SETTINGS = path.join(STATE_DIR, "judge-settings.json");

const POLL_MS = 30_000;
/** `dispatch` also ends after this long without jobs, so the session posts
 *  its digest to Slack every few hours. */
const DIGEST_EVERY_MS = 3 * 60 * 60 * 1000;
/** Printed with every batch of jobs, so the session does not depend on
 *  remembering its brief after a restart or a summarised context. */
const JOBS_INSTRUCTION =
  "Start one ordinary subagent per job. Tell it to read the job's prompt file and follow it. When the subagent has returned, run `bun run claude-notes dispatch-end <key>` for its job.";
/** Jobs in progress at once. The session's subagents start their own
 *  subagents, and every one of them counts against the session's limits. */
const MAX_POSTS_RUNNING = 5;
const MAX_TWEETS_RUNNING = 3;
/** X account lookups are small, so one at a time keeps them from crowding out posts. */
const MAX_X_ACCOUNT_LOOKUPS_RUNNING = 1;
/** Tweets the devbox starts in any 24 hours. A subagent records no cost, so
 *  the X share in xShare.ts sees none of the devbox's tweets and never stops
 *  the X run from sending more. Without this limit the tweets used about four
 *  times their share of the week (Jim, 2026-11-02). The limit was 35 at first,
 *  and Jim raised it to 80 on 2026-11-04. At about $0.61 of API cost per tweet
 *  and about $25 per percent of the plan's week, 80 tweets use about 2% a day.
 *  A tweet that is not started is swept as failed by the X run after
 *  CLAUDE_TWEET_MAX_WAIT_MINUTES. */
const MAX_TWEETS_PER_DAY = 80;
const DAY_MS = 24 * 3600_000;
const USAGE_READ_EVERY_MS = 5 * 60_000;

type Job = JobRun & { key: string; prompt: string } & (
    | { kind: "post"; item: QueueItem }
    | { kind: "tweet"; tweet: XTweet }
    | { kind: "message"; draftId: string; message: ReviewerMessage }
    | { kind: "x-account"; creator: CreatorToLookUp }
  );

/** The open jobs, and the keys of the jobs Claude gave up on: reviewer
 *  messages and X account lookups. Those wait for a person and are not
 *  started again. */
type State = { jobs: Job[]; gaveUp: string[] };

function readState(): State {
  return existsSync(JOBS_FILE) ? JSON.parse(readFileSync(JOBS_FILE, "utf8")) : { jobs: [], gaveUp: [] };
}

function writeState(state: State) {
  writeFileSync(JOBS_FILE, JSON.stringify(state, null, 1));
}

function runFolder(name: string): string {
  const dir = path.join(RUNS_DIR, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Writes the prompt of the job's next try to its run folder. A post that is
 *  skipped or cannot be taken gets no prompt, and the job is dropped. */
async function preparePrompt(job: Job): Promise<boolean> {
  let prompt: string;
  if (job.kind === "post") {
    const start = await beginPost(job.item, job.runDir, job.attempt);
    if (start.kind !== "ready") return false;
    prompt = postPrompt({ host: "devbox", item: job.item, dir: start.dir, runDir: job.runDir, runId: start.postRun.runId, picks: start.postRun.picks, asked: start.asked });
  } else if (job.kind === "tweet") {
    await beginTweet(job.tweet, job.attempt);
    prompt = tweetPrompt({ host: "devbox", tweet: job.tweet, runDir: job.runDir });
  } else if (job.kind === "x-account") {
    prompt = xAccountPrompt({ creator: job.creator, runDir: job.runDir });
  } else {
    prompt = messagePrompt({ host: "devbox", ...job.message, ...(await messageContext(job.draftId)), runDir: job.runDir });
  }
  writeFileSync(job.prompt, prompt);
  return true;
}

const newRun = (key: string) => {
  const runDir = runFolder(key);
  return { key, runDir, prompt: path.join(runDir, "prompt.md"), attempt: 1, startedAt: Date.now(), weeklyAtStart: null };
};

/** The jobs waiting for a Claude, within the limits of jobs in progress. */
async function newJobs(state: State): Promise<Job[]> {
  const open = new Set(state.jobs.map((job) => job.key));
  const running = (kind: Job["kind"]) => state.jobs.filter((job) => job.kind === kind).length;
  const jobs: Job[] = [];
  const tweets = (await openXTweets()).waiting.filter((tweet) => !open.has(`x-${tweet.runId}`));
  // A tweet's run row is written when it ends, so the running ones count separately.
  const tweetsToday = (await claudeRunsSince(CLAUDE_RUN_TAGS.tweet, new Date(Date.now() - DAY_MS))) + running("tweet");
  const tweetSlots = Math.min(MAX_TWEETS_RUNNING - running("tweet"), MAX_TWEETS_PER_DAY - tweetsToday);
  for (const tweet of tweets.slice(0, Math.max(0, tweetSlots))) jobs.push({ ...newRun(`x-${tweet.runId}`), kind: "tweet", tweet });
  if (running("x-account") < MAX_X_ACCOUNT_LOOKUPS_RUNNING) {
    const creator = (await creatorsToLookUp()).find((c) => !open.has(`xacct-${c.slug}`) && !state.gaveUp.includes(`xacct-${c.slug}`));
    if (creator) jobs.push({ ...newRun(`xacct-${creator.slug}`), kind: "x-account", creator });
  }
  if ((await readSettings()).writer !== "claude") return jobs;
  for (const [draftId, message] of await waitingMessages()) {
    const key = `message-${draftId}`;
    if (!open.has(key) && !state.gaveUp.includes(key)) jobs.push({ ...newRun(key), kind: "message", draftId, message });
  }
  const items = (await claudeQueue()).waiting.filter((item) => !open.has(item.id));
  for (const item of items.slice(0, Math.max(0, MAX_POSTS_RUNNING - running("post")))) jobs.push({ ...newRun(item.id), kind: "post", item });
  return jobs;
}

function describe(job: Job): string {
  if (job.kind === "post") return job.item.title ?? job.item.url;
  if (job.kind === "tweet") return `X tweet ${job.tweet.tweetId}`;
  if (job.kind === "x-account") return `the X account of ${job.creator.name}`;
  return `${job.message.from}'s message on draft ${job.draftId}`;
}

function endJob(job: Job, end: JobEnd) {
  if (job.kind === "post") return endPost(job, end);
  if (job.kind === "tweet") return endTweet(job, end);
  if (job.kind === "x-account") return endXAccountLookup(job, end);
  return endAnswer(job.draftId, job, end);
}

/** Reads the plan's usage when the last reading is 5 minutes old. A failed
 *  reading is only logged: the next one is due in 5 minutes, and only half an
 *  hour without a reading counts as the note writer being down. */
async function readUsageWhenDue() {
  const readAt = existsSync(USAGE_READ_AT_FILE) ? Number(readFileSync(USAGE_READ_AT_FILE, "utf8")) : 0;
  if (Date.now() - readAt < USAGE_READ_EVERY_MS) return;
  writeFileSync(USAGE_READ_AT_FILE, String(Date.now()));
  try {
    const reading = await readUsage();
    await recordUsage(reading);
    console.error(`${reading.at} the plan is at ${reading.weekly}% of its week`);
  } catch (err) {
    console.error(`Could not read the usage: ${(err as Error).message}`);
  }
}

/** Waits until jobs are ready, starts them, prints them and exits. */
export async function dispatch() {
  mkdirSync(RUNS_DIR, { recursive: true });
  const startedAt = Date.now();
  for (;;) {
    await readUsageWhenDue();
    const state = readState();
    const started: Job[] = [];
    for (const job of await newJobs(state)) if (await preparePrompt(job)) started.push(job);
    if (started.length > 0) {
      // Preparing the prompts can take minutes, and dispatch-end may close a
      // job in the meantime. So the jobs are read again before the new ones
      // are added, or a closed job would come back.
      const current = readState();
      writeState({ ...current, jobs: [...current.jobs, ...started] });
      const jobs = started.map((job) => ({ key: job.key, kind: job.kind, what: describe(job), prompt: job.prompt }));
      return console.log(JSON.stringify({ wake: "jobs", instruction: JOBS_INSTRUCTION, jobs, inProgress: current.jobs.length + started.length }, null, 2));
    }
    if (Date.now() - startedAt > DIGEST_EVERY_MS) return console.log(JSON.stringify({ wake: "digest", inProgress: state.jobs.map((job) => job.key) }));
    await Bun.sleep(POLL_MS);
  }
}

/** After a job's subagent returned: closes the job, or prepares one more try
 *  and prints its prompt. */
export async function dispatchEnd(key: string) {
  const state = readState();
  const job = state.jobs.find((j) => j.key === key);
  if (!job) throw new Error(`No open job ${key}. The open jobs are: ${state.jobs.map((j) => j.key).join(", ") || "none"}`);
  // A subagent of the session writes no Claude Code output, so neither the
  // usage at its end nor its cost is known.
  const outcome = await endJob(job, { weeklyAtEnd: null, apiCostUsd: null });
  const retry = outcome === "retry" ? { ...job, attempt: job.attempt + 1, startedAt: Date.now() } : null;
  const retrying = retry !== null && (await preparePrompt(retry));
  // Closing the job takes a while, and a running dispatch may add new jobs in
  // the meantime. So the jobs are read again here, or those new jobs would be lost.
  const current = readState();
  const others = current.jobs.filter((j) => j.key !== key);
  if (retrying) {
    writeState({ ...current, jobs: [...others, retry] });
    return console.log(`RETRY ${describe(retry)}: start a subagent on ${retry.prompt}`);
  }
  const gaveUp = outcome === "gave_up" ? [...current.gaveUp, key] : current.gaveUp;
  writeState({ jobs: others, gaveUp });
  console.log(`CLOSED ${describe(job)}`);
}

/** Runs the note judge and rebuilds the examples once a day. */
export async function dispatchServices() {
  mkdirSync(RUNS_DIR, { recursive: true });
  if (!existsSync(JUDGE_SETTINGS)) writeFileSync(JUDGE_SETTINGS, "{}");
  const judge = noteJudge({ runFolder, mayStart: async () => true, runSettings: JUDGE_SETTINGS });
  for (let first = true; ; first = false) {
    refreshExamples(DEVBOX_EXAMPLES_PATH);
    await judge.tick(first);
    await Bun.sleep(POLL_MS);
  }
}
