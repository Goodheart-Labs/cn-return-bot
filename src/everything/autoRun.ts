/**
 * Runs enqueue-and-process cycles until a time budget runs out. This is what
 * the Everything Priority Feeds workflow runs. Each cycle checks that the
 * machine's services are well, enqueues the next unprocessed feed items,
 * BATCH_SIZE of them, and drains the backlog tiers of the queue. A new cycle
 * only starts while the total elapsed time is still under the budget. A quick
 * item such as an ACX open thread takes about 3 minutes, so several of them
 * fit into one 30-minute dispatch slot instead of wasting it. A long item is
 * never cut short by the time budget. It runs to completion even past it.
 *
 * Reader requests are not consumed here any more. The intake service on the
 * machine owns them, because a reader is watching a spinner and a half-hour
 * tick is exactly what this ticket removes. This run instead checks that
 * intake is doing its job, and fails loudly when it is not.
 *
 * We stop when a cycle drained nothing from the queue, which also covers the
 * day whose feed budget is already spent. We deliberately do not stop when
 * nothing new was enqueued. That way an item that autoEnqueue's triage put back
 * in the queue is still processed.
 *
 * Usage:
 *   bun run src/everything/autoRun.ts
 */

import "dotenv/config";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { fetchClaimCheckHealth, fetchExtractionHealth, queueIsStuck } from "../service/client";
import { runAutoEnqueue } from "./autoEnqueue";
import { oldestPendingRequestAgeSeconds } from "./db";
import { ensureYtDlp } from "./sources/youtube";
import { duration } from "./logFormat";
import { describeSpend, feedBudgetExhausted, todaySpendUsd } from "./spendCap";
import { drainQueue } from "./worker";

const RUN_TIME_BUDGET_MS = 5 * 60_000;

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

async function main() {
  ensureYtDlp();
  const start = Date.now();
  for (let cycle = 1; ; cycle++) {
    console.log(
      `\n═══ cycle ${cycle} · started ${duration(Date.now() - start)} ago · today so far: ${describeSpend(await todaySpendUsd())}`,
    );
    await assertMachineHealthy();
    if (await feedBudgetExhausted()) {
      console.log(`Feed budget reached (${describeSpend(await todaySpendUsd())}) — not enqueueing or processing today`);
      break;
    }
    await runAutoEnqueue();
    const processed = await drainQueue();
    console.log(
      `\n═══ cycle ${cycle} done · checked ${processed} item${processed === 1 ? "" : "s"} · today so far: ${describeSpend(await todaySpendUsd())}`,
    );
    if (processed === 0) break;
    if (Date.now() - start >= RUN_TIME_BUDGET_MS) {
      console.log(`Time budget spent (${duration(Date.now() - start)}) — stopping after this cycle`);
      break;
    }
  }
  try {
    await closeBrowser();
  } catch {}
}

main().catch((err) => {
  console.error("[autoRun] Fatal error:", err);
  process.exit(1);
});
