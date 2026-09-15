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
 * With one item per run, a fresh pick, newer and at a higher tier, would
 * otherwise be taken before a resumed or retried item every time and those
 * would never get their turn.
 *
 * Usage:
 *   bun run src/everything/autoRun.ts
 */

import "dotenv/config";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { fetchClaimCheckHealth, fetchExtractionHealth, queueIsStuck } from "../service/client";
import { runAutoEnqueue, triageQueue } from "./autoEnqueue";
import { fetchFeedPacing, oldestPendingRequestAgeSeconds, setFeedAlarm } from "./db";
import { ensureYtDlp } from "./sources/youtube";
import { duration } from "./logFormat";
import {
  affordablePostsPerDay,
  computeNextRun,
  describeAlarm,
  describePacing,
  nextAlarm,
} from "./pacing";
import { describeSpend, FEED_BUDGET_USD, feedBudgetExhausted, todaySpendUsd } from "./spendCap";
import { feedItemsQueued, logQueue, processNextFeedItem } from "./worker";

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

/** Tidies the queue and processes one feed item. Returns whether an item was
 *  started, which is what the alarm is measured from. The snapshot is read
 *  here for the mean post cost, which decides how many creators the walk
 *  admits. */
async function processOneFeedItem(): Promise<boolean> {
  await triageQueue();
  if (await feedBudgetExhausted()) {
    console.log(`Feed budget reached (${describeSpend(await todaySpendUsd())}) — not enqueueing or processing today`);
    return false;
  }
  const snapshot = await fetchFeedPacing();
  const nextRun = computeNextRun(snapshot, FEED_BUDGET_USD);
  console.log(describePacing(nextRun, snapshot, FEED_BUDGET_USD));
  const queue = await logQueue();
  if (!feedItemsQueued(queue)) await runAutoEnqueue(affordablePostsPerDay(nextRun.meanPostCostUsd, FEED_BUDGET_USD));
  const ended = await processNextFeedItem();
  if (ended === "empty") console.log("Nothing to process · every creator we walk is caught up");
  return ended !== "empty";
}

/** Sets the alarm the database starts the next run on. The snapshot is read
 *  again here, after the item, so the interval sees this item's start and
 *  whatever the day has cost by now, reader pages included. */
async function setNextAlarm(started: boolean): Promise<void> {
  const snapshot = await fetchFeedPacing();
  const nextRun = computeNextRun(snapshot, FEED_BUDGET_USD);
  const alarm = nextAlarm(nextRun, snapshot, started);
  console.log(`\n${describePacing(nextRun, snapshot, FEED_BUDGET_USD)}\n${describeAlarm(alarm, snapshot)}`);
  await setFeedAlarm(alarm.at, alarm.reason);
}

async function main() {
  ensureYtDlp();
  console.log(`today so far: ${describeSpend(await todaySpendUsd())}`);
  // A sick machine fails the run before any alarm is set. The alarm then stays
  // empty, the database's backstop starts another run 45 minutes later, and
  // that red run every 45 minutes is how the sickness stays visible.
  await assertMachineHealthy();
  let started = false;
  try {
    started = await processOneFeedItem();
  } finally {
    // Whatever the item did, the next run must be scheduled, or the pipeline
    // would sleep until the backstop.
    await setNextAlarm(started);
  }
  console.log(`\nrun done · today so far: ${describeSpend(await todaySpendUsd())}`);
  try {
    await closeBrowser();
  } catch {}
}

main().catch((err) => {
  console.error("[autoRun] Fatal error:", err);
  process.exit(1);
});
