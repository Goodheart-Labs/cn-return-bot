/**
 * One feed run of the pipeline. This is what the Everything Priority Feeds
 * workflow runs, and the database starts it when the alarm the previous run
 * set has come (everything_feed_schedule, migration 098). Since the post list
 * (GOO-791) the run does one thing: it checks one post as the notewriter
 * `pipeline` of API v1, and only while the pipeline is subscribed. cn-walk on
 * the services box adds the posts, ends overdue reservations and watches the
 * notewriters, which this run used to do.
 *
 * A run is a straight line: check that the machine's services are well, ask
 * v1's next_post for the pipeline, check the post, finish or fail its
 * reservation, set the alarm for the next run (see pacing.ts), and exit. It
 * never waits and never does a second post. A long post is never cut short;
 * the next alarm is measured from its start, so a post that outlasts its
 * interval is followed at once.
 *
 * Reader requests are not checked here while the pipeline takes them. The
 * intake service on the machine checks them at once, because a reader is
 * watching a spinner.
 *
 * Usage:
 *   bun run src/everything/autoRun.ts
 */

import "dotenv/config";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { fetchClaimCheckHealth, fetchExtractionHealth, queueIsStuck } from "../service/client";
import { fetchFeedPacing, oldestPendingRequestAgeSeconds, pipelineSubscription, setFeedAlarm } from "./db";
import { ensureYtDlp } from "./sources/youtube";
import { duration } from "./logFormat";
import { computeNextRun, describeAlarm, describePacing, MEAN_COST_RULE, nextAlarm, type FeedAlarm } from "./pacing";
import { describeTodaySpend, FEED_BUDGET_USD, feedBudgetExhausted } from "./spendCap";
import { processNextFeedItem } from "./worker";

/** How long a reader request may sit unconsumed before this run fails. Intake
 *  consumes within seconds when it is alive, and its own 60-second poll is the
 *  slowest legitimate path, so a request this old means intake is dead. */
const STALE_REQUEST_LIMIT_SECONDS = 15 * 60;

/** Asks the machine how it is, and throws when something is unwell. The
 *  pipeline needs both services, and the intake service is checked by its
 *  effect: an old unconsumed request means nobody is listening. */
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

type FeedRunOutcome = Awaited<ReturnType<typeof processNextFeedItem>> | "budget_reached" | "unsubscribed";

/** Checks one post for the pipeline, when it takes feed posts and the day's
 *  feed budget is not spent. The pacing block is printed first, so the log
 *  shows the budget before the post. */
async function processOneFeedItem(): Promise<FeedRunOutcome> {
  if (!(await pipelineSubscription()).feed) {
    console.log("The pipeline takes no feed posts, so this run checks nothing");
    return "unsubscribed";
  }
  if (await feedBudgetExhausted()) {
    console.log(`Feed budget reached (${await describeTodaySpend()}) · the pipeline processes nothing more today`);
    return "budget_reached";
  }
  const snapshot = await fetchFeedPacing(MEAN_COST_RULE);
  console.log(describePacing(computeNextRun(snapshot, FEED_BUDGET_USD), snapshot, FEED_BUDGET_USD));
  const ended = await processNextFeedItem();
  if (typeof ended !== "string") console.log(`Nothing for the pipeline to check: ${ended.reason}`);
  return ended;
}

/** Sets the alarm the database starts the next run on. The snapshot is read
 *  again here, after the post, so the interval sees this post's start and
 *  whatever the day has cost by now, reader pages included. */
async function setNextAlarm(started: boolean): Promise<void> {
  const snapshot = await fetchFeedPacing(MEAN_COST_RULE);
  const nextRun = computeNextRun(snapshot, FEED_BUDGET_USD);
  const alarm: FeedAlarm = nextAlarm(nextRun, snapshot, started);
  console.log(`\n${describePacing(nextRun, snapshot, FEED_BUDGET_USD)}\n${describeAlarm(alarm, snapshot)}`);
  await setFeedAlarm(alarm.at, alarm.reason);
}

async function main() {
  ensureYtDlp();
  console.log(`today so far: ${await describeTodaySpend()}`);
  // A sick machine fails the run before any alarm is set. The alarm then stays
  // empty, the database's backstop starts another run 45 minutes later, and
  // that red run every 45 minutes is how the sickness stays visible.
  await assertMachineHealthy();
  let ended: FeedRunOutcome | undefined;
  try {
    ended = await processOneFeedItem();
  } finally {
    // Whatever the post did, the next run must be scheduled, or the pipeline
    // would sleep until the backstop. The alarm is measured from the post's
    // start, so it needs to know whether a post was started.
    await setNextAlarm(ended === "done" || ended === "capped" || ended === "error");
  }
  console.log(`\nrun done · today so far: ${await describeTodaySpend()}`);
  try {
    await closeBrowser();
  } catch {}
  // A failed post is recorded on its reservation, and the run used to end
  // green. On 1 October 2026 every post failed for 16 hours while every run
  // stayed green, and nobody noticed until someone read the logs.
  if (ended === "error") throw new Error("This run's post failed. The reason is in the log above and on its reservation. Failing the run so this is seen.");
}

main().catch((err) => {
  console.error("[autoRun] Fatal error:", err);
  process.exit(1);
});
