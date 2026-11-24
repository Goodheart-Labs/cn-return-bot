/* A Common Notes post (GOO-580, GOO-724, GOO-791). The runner reserves a post
 * through the notewriter API, takes it (reads its text and screens its
 * images, take.ts), and starts one Claude, which saves a draft per passage it
 * checked and writes report.json. The runner then finishes the reservation from
 * that report. A post it cannot finish it fails on, so the post stays listed
 * for the other notewriters. */

import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import * as path from "path";
import type { Json } from "../../everything-core/database.types";
import { pickVariantName } from "../../pipeline/ab-testing/abTests";
import { CLAUDE_CN_TASTE_TEST } from "../../pipeline/ab-testing/abTestsData";
import { CLAUDE_CODE_BOT } from "../../pipeline/orchestration/claudeTweets";
import { EXAMPLES_PATH, postPrompt } from "../prompts";
import { claudeQueue } from "../queue";
import { claudeDraftsSince, endPostRun, logEvent, type PostRunOutcome, type QueueItem, readItem, RUN_ID_ENV, startPostRun } from "../store";
import { take } from "../take";
import { CLAUDE_RUN_TAGS } from "../usageShare";
import { type EndedRun, type JobKind, mayRetry, STOP_BEFORE_DEADLINE_MS } from "./kind";

/** A post Claude reserved. `assignment` is the reservation, under API v1's
 *  name, and `deadline` when the reservation ends unless it is finished. */
export type HeldPost = { assignment: string; deadline: string; item: QueueItem };

/** Posts in progress at once. The list hands out reader requests first, so a
 *  request takes the next free slot. The pace spaces the feed posts by the
 *  weekly usage (src/everything/usagePacing.ts), so this is rarely reached. */
const MAX_POSTS_RUNNING = 5;

/** A post's run row and A/B picks, kept in its run folder. The first attempt
 *  draws the picks and writes the row, and a retry reads them, so both
 *  attempts get the same prompt and the same row. */
type PostRun = { runId: string; picks: Record<string, string> };
const postRunFile = (runDir: string) => path.join(runDir, "run.json");
const reportFile = (runDir: string) => path.join(runDir, "report.json");

async function startPostRunFor(item: QueueItem, runDir: string): Promise<PostRun> {
  const picks = { bot: CLAUDE_CODE_BOT, [CLAUDE_CN_TASTE_TEST.name]: pickVariantName(CLAUDE_CN_TASTE_TEST) };
  const postRun = { runId: await startPostRun(item.id, picks), picks };
  writeFileSync(postRunFile(runDir), JSON.stringify(postRun));
  return postRun;
}

function readPostRun(runDir: string): PostRun | null {
  return existsSync(postRunFile(runDir)) ? JSON.parse(readFileSync(postRunFile(runDir), "utf8")) : null;
}

/** The notewriter API refuses a summary larger than 10 KB (migration 184), and
 *  a report that quotes every passage it checked can be larger. So the API gets
 *  only how many passages ended with each outcome. The full report stays in the
 *  post's run row and in its run folder. A skipped post's reason travels as the
 *  finish call's skip reason, so its counts are simply empty. */
function countOutcomes(report: Record<string, unknown>): Record<string, number> {
  const outcomeCounts: Record<string, number> = {};
  for (const { outcome } of (report.passages ?? []) as { outcome?: string }[]) {
    const key = outcome ?? "unknown";
    outcomeCounts[key] = (outcomeCounts[key] ?? 0) + 1;
  }
  return outcomeCounts;
}

function readReport(runDir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(reportFile(runDir), "utf8"));
  } catch {
    return null;
  }
}

async function heldPost(open: { reservation: string; itemId: string; deadline: string }): Promise<HeldPost> {
  return { assignment: open.reservation, deadline: open.deadline, item: await readItem(open.itemId) };
}

/** Finishes or fails the post's reservation. The time limit stops a Claude
 *  before the reservation's deadline, so this only meets an expired
 *  reservation when the runner itself was down past it. Its notes are posted
 *  all the same, so that is only logged. */
async function endReservation(post: HeldPost, end: () => Promise<unknown>) {
  try {
    await end();
  } catch (err) {
    if (!(err as Error).message.includes("already ended as expired")) throw err;
    console.error(`The reservation of ${post.item.url} expired before the runner could end it: ${(err as Error).message}`);
  }
}

/** Claude fails on the post. The post is never listed to this notewriter
 *  again, and stays listed for the others. */
async function failPost(post: HeldPost, reason: string) {
  await endReservation(post, async () => {
    const outcome = await claudeQueue().fail(post.assignment, reason);
    console.log(`Failed on ${post.item.url}: ${reason}. ${outcome[0]!.toUpperCase()}${outcome.slice(1)}`);
  });
}

const finish = (post: HeldPost, options: { summary?: Json; skipReason?: string }) =>
  endReservation(post, () => claudeQueue().finish(post.assignment, options));

/** A report that lists more notes than the post has drafts means some
 *  `draft` calls failed, for example because a guard hook refused them. The
 *  research is then lost unless a person saves the drafts from the run
 *  folder, so the runner says so in its log and in the events table. */
async function warnAboutUnsavedNotes(post: HeldPost, run: EndedRun, report: Record<string, unknown>) {
  const passages = (report.passages ?? []) as { outcome?: string }[];
  const reported = passages.filter((p) => p.outcome === "note").length;
  const saved = await claudeDraftsSince(post.item.id, new Date(run.startedAt).toISOString());
  if (saved >= reported) return;
  console.error(`UNSAVED NOTES on ${post.item.url}: the report lists ${reported} notes but only ${saved} drafts were saved. The draft files are in ${run.runDir}`);
  await logEvent({ actor: "claude", type: "notes_unsaved", itemId: post.item.id, data: { reported, saved, runDir: run.runDir } });
}

export const postJob: JobKind<HeldPost> = {
  name: "post",
  sessionPrefix: "cn-post-",
  maxRunning: MAX_POSTS_RUNNING,
  tags: () => [CLAUDE_RUN_TAGS.commonNotes, CLAUDE_RUN_TAGS.post],
  key: (post) => post.item.id,

  /** Reserves posts, as many as are due and as slots allow. */
  async waiting(limit) {
    const posts: HeldPost[] = [];
    while (posts.length < limit) {
      const reserved = await claudeQueue().next();
      if (!reserved) break;
      posts.push(await heldPost(reserved));
    }
    return posts;
  },

  async held() {
    return Promise.all((await claudeQueue().held()).map(heldPost));
  },

  /** Takes the post. A skipped or flagged post is finished without a Claude,
   *  and a post that cannot be taken is failed. */
  async prepare(post, runDir, attempt) {
    let taken;
    try {
      taken = await take(post.item.id);
    } catch (err) {
      await failPost(post, (err as Error).message);
      throw err;
    }
    if (taken.kind === "skipped") {
      console.log(`Skipped ${post.item.url}: ${taken.reason}`);
      await finish(post, { skipReason: taken.reason });
      return null;
    }
    // A post Claude checked before has its last report in the same folder. It
    // must not pass for this run's report.
    if (attempt === 1) rmSync(reportFile(runDir), { force: true });
    const postRun = (attempt > 1 && readPostRun(runDir)) || (await startPostRunFor(post.item, runDir));
    return {
      prompt: postPrompt({ item: post.item, dir: taken.dir, runDir, picks: postRun.picks, asked: taken.asked }),
      command: { model: "opus", effort: "high", appendSystemPromptFile: EXAMPLES_PATH, env: { [RUN_ID_ENV]: postRun.runId } },
    };
  },

  stopAt: (post) => Date.parse(post.deadline) - STOP_BEFORE_DEADLINE_MS,

  ref(_post, runDir) {
    const postRun = readPostRun(runDir);
    return postRun && { everything_pipeline_run_id: postRun.runId };
  },

  /** Closes the post from its Claude's report. Finishing it also answers the
   *  passages readers asked about. Without a report and without drafts the
   *  post gets one more try, and after that Claude fails on it. */
  async close(post, run) {
    const report = readReport(run.runDir);
    const postRun = readPostRun(run.runDir);
    const usageNote = { weeklyAtStart: run.weeklyAtStart, weeklyAtEnd: run.weeklyAtEnd, minutes: Math.round((Date.now() - run.startedAt) / 60_000), attempt: run.attempt };
    console.log(`The Claude on ${post.item.url} ended after ${usageNote.minutes} minutes, ${report ? "with" : "without"} a report`);
    const record = async (outcome: PostRunOutcome) => {
      if (postRun) await endPostRun(postRun.runId, outcome, { runDir: run.runDir, report, ...usageNote });
    };
    if (report?.skipped) {
      await record("skipped");
      await finish(post, { summary: { outcomeCounts: countOutcomes(report), ...usageNote }, skipReason: String(report.reason ?? "nothing worth checking") });
      return "closed";
    }
    if (report) {
      await warnAboutUnsavedNotes(post, run, report);
      await record("done");
      await finish(post, { summary: { outcomeCounts: countOutcomes(report), ...usageNote } });
      return "closed";
    }
    if ((await claudeDraftsSince(post.item.id, new Date(run.startedAt).toISOString())) > 0) {
      await record("incomplete");
      await finish(post, { summary: { incomplete: true, reason: `Claude exited without a report after saving drafts; see ${run.runDir}`, ...usageNote } });
      return "closed";
    }
    if (mayRetry(run)) return "retry";
    await record("failed");
    await failPost(post, run.timedOut ? `Claude was stopped before the reservation's deadline without a report; see ${run.runDir}` : `Claude exited twice without a report; see ${run.runDir}`);
    return "closed";
  },
};
