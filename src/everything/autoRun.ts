/**
 * Runs the paced feed loop. This is what the Everything Priority Feeds
 * workflow runs, every 30 minutes. Each cycle checks that the machine's
 * services are well, tidies the queue, and then asks the pacing gate whether a
 * feed post may start (see pacing.ts). When it may, the cycle walks the
 * creators for one new post if nothing is waiting, and processes exactly one
 * feed item. When it may not, the run waits in place if the gate opens soon,
 * and otherwise leaves the rest to a later dispatch. A long item is never cut
 * short. It runs to completion, and the gate is asked again afterwards.
 *
 * Reader requests are not consumed here. The intake service on the machine
 * owns them, because a reader is watching a spinner and a half-hour tick is
 * exactly what that ticket removed. This run instead checks that intake is
 * doing its job, and fails loudly when it is not.
 *
 * The walk for new posts runs only when the feed tiers of the queue are empty.
 * Under pacing there is one item per opening, and a fresh pick, newer and at a
 * higher tier, would otherwise be taken before a resumed or retried item every
 * time and those would never get their turn.
 *
 * Usage:
 *   bun run src/everything/autoRun.ts
 */

import "dotenv/config";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { fetchClaimCheckHealth, fetchExtractionHealth, queueIsStuck } from "../service/client";
import { runAutoEnqueue, triageQueue } from "./autoEnqueue";
import { fetchFeedPacing, oldestPendingRequestAgeSeconds } from "./db";
import { ensureYtDlp } from "./sources/youtube";
import { duration } from "./logFormat";
import {
  computeFeedGate,
  describeGate,
  MAX_IN_RUN_WAIT_MS,
  MAX_RUN_AGE_TO_WAIT_MS,
  MEAN_COST_FALLBACK_HOURS,
  MEAN_COST_MIN_POSTS,
  MEAN_COST_WINDOW_HOURS,
  waitMs,
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

/** What one cycle decided, so the loop reads as a list of outcomes. */
type CycleOutcome = "processed" | "waited" | "stop";

async function runCycle(runStartedAt: number): Promise<CycleOutcome> {
  await assertMachineHealthy();
  await triageQueue();
  if (await feedBudgetExhausted()) {
    console.log(`Feed budget reached (${describeSpend(await todaySpendUsd())}) — not enqueueing or processing today`);
    return "stop";
  }

  const snapshot = await fetchFeedPacing(MEAN_COST_WINDOW_HOURS, MEAN_COST_MIN_POSTS, MEAN_COST_FALLBACK_HOURS);
  const gate = computeFeedGate(snapshot, FEED_BUDGET_USD);
  console.log(describeGate(gate, snapshot, FEED_BUDGET_USD));
  const wait = waitMs(gate, snapshot);
  if (wait > 0) {
    if (gate.closedForToday) return "stop";
    if (wait > MAX_IN_RUN_WAIT_MS) {
      console.log(`         longer than this run waits in place · leaving it to a later dispatch`);
      return "stop";
    }
    if (Date.now() - runStartedAt > MAX_RUN_AGE_TO_WAIT_MS) {
      console.log(`         this run is ${duration(Date.now() - runStartedAt)} old, too old to start a wait · leaving it to a later dispatch`);
      return "stop";
    }
    console.log(`         waiting in place`);
    await Bun.sleep(wait);
    return "waited";
  }

  const queue = await logQueue();
  if (!feedItemsQueued(queue)) await runAutoEnqueue();
  const ended = await processNextFeedItem();
  if (ended === "empty") {
    console.log("Nothing to process · every creator we walk is caught up");
    return "stop";
  }
  // The hard cap cut this item short. It is back in the queue with its
  // finished claims kept, and tomorrow's first opening resumes it.
  if (ended === "capped") return "stop";
  return "processed";
}

async function main() {
  ensureYtDlp();
  const runStartedAt = Date.now();
  let processed = 0;
  for (let cycle = 1; ; cycle++) {
    console.log(
      `\n═══ cycle ${cycle} · run started ${duration(Date.now() - runStartedAt)} ago · today so far: ${describeSpend(await todaySpendUsd())}`,
    );
    const outcome = await runCycle(runStartedAt);
    if (outcome === "processed") processed++;
    if (outcome === "stop") break;
  }
  console.log(`\n═══ run done · checked ${processed} item${processed === 1 ? "" : "s"} · today so far: ${describeSpend(await todaySpendUsd())}`);
  try {
    await closeBrowser();
  } catch {}
}

main().catch((err) => {
  console.error("[autoRun] Fatal error:", err);
  process.exit(1);
});
