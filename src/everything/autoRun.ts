/**
 * One feed run. This is what the Everything Priority Feeds workflow runs, and
 * the database starts it when the alarm the previous run set has come
 * (everything_feed_schedule, migration 098). A run is a straight line: check
 * that the machine's services are well, tidy the queue, process one feed
 * item, set the alarm for the next run (see pacing.ts), and exit. It never
 * waits and never does a second item. A long item is never cut short; the
 * next alarm is measured from its start, so a post that outlasts its interval
 * is followed at once.
 *
 * A run does not ask whether it may start. It starts because its time came,
 * because someone started it by hand, or because the database's backstop
 * fired after a run that never set its alarm. In the last two cases the post
 * starts ahead of schedule, and the next alarm, measured from that post with
 * the money actually left, absorbs it.
 *
 * Reader requests are not consumed here. The intake service on the machine
 * owns them, because a reader is watching a spinner and a half-hour tick is
 * exactly what that ticket removed. This run instead checks that intake is
 * doing its job, and fails loudly when it is not.
 *
 * The walk for new posts runs only when the feed tiers of the queue are empty.
 * With one item per run, a fresh pick would otherwise be taken before an item
 * a killed run left half done, and that item would never get its turn. A
 * failed post does not wait in the queue. The walk picks it again in rank
 * order (see autoEnqueue.ts).
 *
 * While the Claude note writer is on, the walk works for Claude instead
 * (GOO-587). Claude's posts cost no money but use Nathan's weekly Claude
 * usage, so they are spaced by usagePacing.ts. The walk adds a post for Claude
 * when one is due and fewer than 3 feed posts are in the queue, and the
 * alarm wakes the next run when the next one is due. Once Claude's week is at
 * its target, the walk adds nothing until the reset, and Claude still takes
 * what is queued. Nothing goes to the pipeline while Claude writes the notes.
 * Instead this run goes red when the runner on ai-box has gone quiet, and
 * when Claude failed on a post since the last run reported its failures.
 *
 * Usage:
 *   bun run src/everything/autoRun.ts
 */

import "dotenv/config";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { fetchClaimCheckHealth, fetchExtractionHealth, queueIsStuck } from "../service/client";
import { runAutoEnqueue, triageQueue } from "./autoEnqueue";
import {
  claudeWritesNotes,
  fetchFeedPacing,
  fetchUsageSnapshot,
  oldestPendingRequestAgeSeconds,
  setFeedAlarm,
  takeUnreportedClaudeFailures,
  type QueuedItemSummary,
} from "./db";
import { AVATARS_PER_RUN, refreshStaleAvatars } from "./projectAvatars";
import { ensureYtDlp } from "./sources/youtube";
import { duration } from "./logFormat";
import { quotaRanOutThisRun } from "../pipeline/media/youtubeDataApi";
import {
  computeNextRun,
  describeAlarm,
  describePacing,
  MEAN_COST_RULE,
  nextAlarm,
  type FeedAlarm,
} from "./pacing";
import { describeTodaySpend, FEED_BUDGET_USD, feedBudgetExhausted } from "./spendCap";
import { computeClaudePacing, describeClaudePacing, type ClaudePacing } from "./usagePacing";
import { logQueue, processNextFeedItem, queuedFeedItemCount } from "./worker";

/** How long a reader request may sit unconsumed before this run fails. Intake
 *  consumes within seconds when it is alive, and its own 60-second poll is the
 *  slowest legitimate path, so a request this old means intake is dead. */
const STALE_REQUEST_LIMIT_SECONDS = 15 * 60;

/** Asks the machine how it is, and throws when something is unwell.
 *
 * This run is also the only thing watching the machine, so sickness must fail
 * the run. A red run in the Actions list is how a dead or wedged machine
 * becomes visible, exactly the way a broken pipeline is visible today. Three
 * things are checked: each service answers, neither service's queue is stuck,
 * and the intake service is consuming reader requests. Intake has no port of
 * its own, so it is checked by its effect: an old unconsumed request means
 * nobody is listening. */
async function assertMachineHealthy(): Promise<void> {
  const healths = await Promise.all([fetchClaimCheckHealth(), fetchExtractionHealth()]);
  for (const health of healths) {
    const oldest = (label: string, seconds: number | null) => (seconds === null ? "" : `, oldest ${label} ${seconds}s`);
    console.log(
      `[${health.service}] ${health.inFlight} in flight, ${health.waiting} waiting` +
        oldest("waiting", health.oldestWaitSeconds) +
        oldest("in flight", health.oldestInFlightSeconds),
    );
    if (queueIsStuck(health)) {
      throw new Error(`The ${health.service} service is stuck. Failing the run so this is seen.`);
    }
  }
  const requestAge = await oldestPendingRequestAgeSeconds();
  if (requestAge !== null && requestAge >= STALE_REQUEST_LIMIT_SECONDS) {
    throw new Error(
      `A reader request has waited ${duration(requestAge * 1000)} unconsumed. ` +
        "The intake service should take it within seconds, so it is probably down. Failing the run so this is seen.",
    );
  }
}

type FeedRunOutcome = Awaited<ReturnType<typeof processNextFeedItem>> | "budget_reached";

/** How the run's item ended, the Claude note writer's pacing, and when its
 *  next post is due if the alarm should wake the next run for it. */
type FeedRunResult = { ended: FeedRunOutcome; claude: ClaudePacing | null; claudeDueAt: Date | null };

/** Who gets the next feed post. Null while the pipeline writes the notes. */
async function claudePacing(): Promise<ClaudePacing | null> {
  if (!(await claudeWritesNotes())) return null;
  const snapshot = await fetchUsageSnapshot();
  const pacing = computeClaudePacing(snapshot);
  console.log(describeClaudePacing(pacing, snapshot));
  return pacing;
}

/** A post Claude works on stays in the queue until Claude finishes it. So the
 *  feed posts in the queue are the ones Claude is working on plus the ones it
 *  has not started yet. At this many, no new post is added: the runner is busy
 *  or down, and another post would only wait. Jim picked 3 on 2026-10-26. */
const MAX_QUEUED_FEED_POSTS_FOR_CLAUDE = 3;

/** Adds a post for Claude when one is due and the queue holds fewer than
 *  MAX_QUEUED_FEED_POSTS_FOR_CLAUDE feed posts. Returns when the next post is
 *  due: one interval from now after a walk, the due time when it lies ahead,
 *  and null when the next run should simply come after the idle wait. */
async function walkForClaude(queue: QueuedItemSummary[], pacing: Extract<ClaudePacing, { kind: "paced" }>): Promise<Date | null> {
  if (pacing.dueAt.getTime() > Date.now()) return pacing.dueAt;
  const queued = queuedFeedItemCount(queue);
  if (queued >= MAX_QUEUED_FEED_POSTS_FOR_CLAUDE) {
    console.log(`\n${queued} feed posts are in the queue already · no new post for Claude`);
    return null;
  }
  const walked = (await runAutoEnqueue()) > 0;
  return walked && Number.isFinite(pacing.intervalMs) ? new Date(Date.now() + pacing.intervalMs) : null;
}

/** Walks for a new feed post when one is due. Returns when the alarm should
 *  wake the next run for Claude's next post. */
async function walkForNextPost(queue: QueuedItemSummary[], claude: ClaudePacing | null): Promise<Date | null> {
  if (claude?.kind === "paced") return walkForClaude(queue, claude);
  // A silent runner takes no post, so the walk adds none for it.
  if (!claude && queuedFeedItemCount(queue) === 0) await runAutoEnqueue();
  return null;
}

/** Tidies the queue, walks for a new post when one is due, and processes one
 *  feed item. The day's feed budget stops only the pipeline: Claude's posts
 *  cost no money, so a walk for Claude still runs. The pacing block is printed
 *  here too, so the log shows the budget before the walk. */
async function processOneFeedItem(): Promise<FeedRunResult> {
  await triageQueue();
  const claude = await claudePacing();
  if (await feedBudgetExhausted()) {
    console.log(`Feed budget reached (${await describeTodaySpend()}) · the pipeline enqueues and processes nothing more today`);
    const claudeDueAt = claude?.kind === "paced" ? await walkForClaude(await logQueue(), claude) : null;
    return { ended: "budget_reached", claude, claudeDueAt };
  }
  const snapshot = await fetchFeedPacing(MEAN_COST_RULE);
  const nextRun = computeNextRun(snapshot, FEED_BUDGET_USD);
  console.log(describePacing(nextRun, snapshot, FEED_BUDGET_USD));
  const claudeDueAt = await walkForNextPost(await logQueue(), claude);
  const ended = await processNextFeedItem();
  if (ended === "empty") {
    console.log(`Nothing for the pipeline to process${claude ? " · feed posts are left for Claude" : ""}`);
  }
  return { ended, claude, claudeDueAt };
}

/** Sets the alarm the database starts the next run on. The snapshot is read
 *  again here, after the item, so the interval sees this item's start and
 *  whatever the day has cost by now, reader pages included. Claude's next
 *  post wins when it is due before the pipeline's next run. */
async function setNextAlarm(started: boolean, claudeDueAt: Date | null): Promise<void> {
  const snapshot = await fetchFeedPacing(MEAN_COST_RULE);
  const nextRun = computeNextRun(snapshot, FEED_BUDGET_USD);
  const pipelineAlarm = nextAlarm(nextRun, snapshot, started);
  const alarm: FeedAlarm = claudeDueAt && claudeDueAt < pipelineAlarm.at ? { at: claudeDueAt, reason: "usage" } : pipelineAlarm;
  console.log(`\n${describePacing(nextRun, snapshot, FEED_BUDGET_USD)}\n${describeAlarm(alarm, snapshot)}`);
  await setFeedAlarm(alarm.at, alarm.reason);
}

/** Why this run must go red. The run fails only at its end, after its item
 *  and its alarm, so a problem never stops the schedule. */
async function problemsToReport(result: FeedRunResult): Promise<string[]> {
  const problems: string[] = [];
  // An exhausted YouTube quota does not stop the run, because Substack and
  // LessWrong posts can still be checked. But it must not stay a log line: for
  // five days in September 2026 the quota ran out every afternoon and nobody
  // noticed.
  if (quotaRanOutThisRun()) problems.push("The YouTube Data API quota is used up until 07:00 UTC. No YouTube channel could be listed.");
  // A failed item is recorded on its row, and the run used to end green. On
  // 1 October 2026 every item failed for 16 hours while every run stayed
  // green, and nobody noticed until someone read the logs. A young video that
  // has no captions yet is the one expected error, and it ends as
  // "no_captions_yet" instead. On 10 October 2026 such videos made 30 of 31
  // red runs and buried the failures that mattered (GOO-422).
  if (result.ended === "error") problems.push("This run's item failed. The reason is in the log above and in everything_items.error.");
  // Nothing else takes the queued posts while the runner is down, so the
  // queue only grows until someone sees this.
  if (result.claude?.kind === "runner_silent") problems.push(`${result.claude.reason}. Nothing takes the queued posts until it reports again.`);
  // The runner on ai-box has no red run of its own, so its failures turn
  // this run red, the same way this run's own failed item does.
  for (const failure of await takeUnreportedClaudeFailures()) {
    problems.push(`The Claude note writer failed on ${failure.url} at ${failure.at}: ${failure.reason}`);
  }
  return problems;
}

async function main() {
  ensureYtDlp();
  console.log(`today so far: ${await describeTodaySpend()}`);
  // A sick machine fails the run before any alarm is set. The alarm then stays
  // empty, the database's backstop starts another run 45 minutes later, and
  // that red run every 45 minutes is how the sickness stays visible.
  await assertMachineHealthy();
  let result: FeedRunResult | undefined;
  try {
    result = await processOneFeedItem();
  } finally {
    // Whatever the item did, the next run must be scheduled, or the pipeline
    // would sleep until the backstop. The alarm is measured from the item's
    // start, so it needs to know whether an item was started.
    const ended = result?.ended;
    await setNextAlarm(ended === "done" || ended === "capped" || ended === "error" || ended === "no_captions_yet", result?.claudeDueAt ?? null);
  }
  // Creator pictures for the website cost no LLM money, so they refresh even
  // on a capped day. They run last, after the alarm is set, so a slow source
  // never delays the item or the schedule.
  await refreshStaleAvatars(AVATARS_PER_RUN);
  console.log(`\nrun done · today so far: ${await describeTodaySpend()}`);
  try {
    await closeBrowser();
  } catch {}
  const problems = await problemsToReport(result);
  if (problems.length > 0) throw new Error(`${problems.join("\n")}\nFailing the run so this is seen.`);
}

main().catch((err) => {
  console.error("[autoRun] Fatal error:", err);
  process.exit(1);
});
