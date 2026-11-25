/* The Claude note writer's runner (GOO-580, GOO-787). It runs all the time on
 * Nathan's ai-box as a systemd service, under Nathan's user, and starts one
 * headless Claude per job: a Common Notes post, an X tweet the X run handed to
 * Claude, a note to judge, a creator whose X account nobody looked up, and a
 * reviewer's message. Since GOO-787 its Claudes run on Jim's notewriter
 * account, whose login is in its own config folder (CLAUDE_CONFIG_DIR in the
 * unit file). The same code runs on hq as claude-hq-nathan, for posts only.
 *
 * The scheduler (scheduler.ts) does what is the same for every job, and one
 * module per kind in ../jobs/ does the rest. This file wires them up and runs
 * the loop.
 *
 * Usage: bun run claude-notes run */

import { spawnSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import * as path from "path";
import { claudeEnded } from "../alerts";
import { judgeJob } from "../jobs/judge";
import type { JobKind } from "../jobs/kind";
import { postJob } from "../jobs/post";
import { reviewAnswerJob } from "../jobs/reviewAnswer";
import { pangramJob } from "../jobs/pangram";
import { tweetJob } from "../jobs/tweet";
import { xHandleJob } from "../jobs/xHandle";
import { EXAMPLES_PATH, REPO } from "../prompts";
import { imageScreenOn } from "../imageScreen";
import { claudeQueue } from "../queue";
import { recordClaudeRun } from "../store";
import { DRAIN_FILE, mayStartClaudes, POSTS_ONLY, weeklyUsage } from "./planUsage";
import { createScheduler } from "./scheduler";
import { runUsage } from "./runUsage";
import { claudeFailure, runFolder, RUNS_DIR, sessionAlive, sessionStartedAt, startSession, stopSession } from "./session";

const POLL_MS = 30_000;
/** Run folders older than this are deleted. By then their job is closed and
 *  everything that matters is in the database. */
const KEEP_RUN_FOLDERS_MS = 30 * 24 * 3600_000;
const DAY_MS = 24 * 3600_000;
/** What the runner is doing, written on every round for the deploy to read:
 *  plain lines of name=value, so the deploy never runs anything from it. */
const RUNNER_STATE_FILE = path.join(RUNS_DIR, "runner-state");

/** The kinds in the order their waiting work starts: the small and urgent
 *  first, posts last, since they take a slot for the longest. */
const KINDS: JobKind<any>[] = POSTS_ONLY ? [postJob] : [reviewAnswerJob, tweetJob, pangramJob, judgeJob, xHandleJob, postJob];

const scheduler = createScheduler({
  kinds: KINDS,
  sessions: { start: startSession, alive: sessionAlive, stop: stopSession, startedAt: sessionStartedAt, failure: claudeFailure, usage: runUsage },
  runFolder,
  mayStart: mayStartClaudes,
  weekly: weeklyUsage,
  recordRun: recordClaudeRun,
  claudeEnded,
});

/** Tells the deploy whether the freeze has taken hold: the runner saw the
 *  drain file and no Claude of it is at work. */
function writeRunnerState() {
  const lines = [`at=${Math.floor(Date.now() / 1000)}`, `draining=${existsSync(DRAIN_FILE) ? 1 : 0}`, `running=${scheduler.running()}`];
  writeFileSync(RUNNER_STATE_FILE, `${lines.join("\n")}\n`);
}

let examplesBuiltAt = 0;

/** Rebuilds the examples once a day, outside the checkout. The first build
 *  starts from the checkout's copy, because a rebuild keeps old entries that
 *  prod no longer yields. */
function refreshExamples() {
  if (Date.now() - examplesBuiltAt < DAY_MS) return;
  examplesBuiltAt = Date.now();
  if (!existsSync(EXAMPLES_PATH)) copyFileSync(path.join(REPO, "docs/note-examples.md"), EXAMPLES_PATH);
  const built = spawnSync("bun", [path.join(REPO, "src/claude-notes/buildExamples.ts")], { cwd: REPO, env: { ...process.env, CN_EXAMPLES_PATH: EXAMPLES_PATH }, encoding: "utf8" });
  console.log(built.status === 0 ? built.stdout.trim() : `The examples rebuild failed: ${built.stderr}`);
}

let prunedAt = 0;

/** Deletes the run folders not touched for 30 days, once a day. A tweet's
 *  folder is about 100 KB, so a month of them is about half a gigabyte. */
function pruneRunFolders() {
  if (Date.now() - prunedAt < DAY_MS) return;
  prunedAt = Date.now();
  const cutoff = Date.now() - KEEP_RUN_FOLDERS_MS;
  const kindFolders = KINDS.map((kind) => path.join(RUNS_DIR, kind.name)).filter(existsSync);
  const old = kindFolders.flatMap((folder) => readdirSync(folder).map((name) => path.join(folder, name))).filter((dir) => statSync(dir).mtimeMs < cutoff);
  for (const dir of old) rmSync(dir, { recursive: true, force: true });
  if (old.length > 0) console.log(`Deleted ${old.length} run folders older than 30 days`);
}

mkdirSync(RUNS_DIR, { recursive: true });
console.log(`Claude note writer runner started in ${REPO}, running ${KINDS.map((kind) => kind.name).join(", ")}, ${imageScreenOn() ? "with" : "without"} the image screen`);
for (let first = true; ; first = false) {
  refreshExamples();
  pruneRunFolders();
  // On API v2 any call is the sign of life that cn-walk's silence watch looks
  // for. On v1 the pace update every 5 minutes is.
  await claudeQueue().signOfLife();
  await weeklyUsage();
  await scheduler.tick(first);
  writeRunnerState();
  await Bun.sleep(POLL_MS);
}
