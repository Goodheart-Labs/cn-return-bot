/**
 * Runs enqueue-and-process cycles until a time budget runs out. This is what
 * the Everything Priority Feeds workflow runs. Each cycle first consumes the
 * reader-request inboxes, which costs nothing, then enqueues the next
 * unprocessed feed items, BATCH_SIZE of them, and then drains the queue. A new
 * cycle only starts while the total elapsed time is still under the budget. A
 * quick item such as an ACX open thread takes about 3 minutes, so several of
 * them fit into one 30-minute dispatch slot instead of wasting it. A long item
 * is never cut short by the time budget. It runs to completion even past it.
 *
 * We stop when a cycle drained nothing from the queue, which also covers the
 * day whose spend cap is already reached. We deliberately do not stop when
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
import { consumeRequests } from "./consumeRequests";
import { ensureYtDlp } from "./sources/youtube";
import { duration } from "./logFormat";
import { describeSpend, spendCapReached, todaySpendUsd } from "./spendCap";
import { drainQueue } from "./worker";

const RUN_TIME_BUDGET_MS = 5 * 60_000;

/** Asks both services how they are, and throws when one is unwell.
 *
 * This run is also the only thing watching them, so a sick service must fail
 * the run. A red run in the Actions list is how a machine that is down or
 * wedged becomes visible, exactly the way a broken pipeline is visible today.
 * A queue that is far behind counts as sick too: a backlog that long means the
 * service is stuck rather than busy, and piling more work onto it would only
 * hide that. */
async function assertServicesReady(): Promise<void> {
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
}

async function main() {
  ensureYtDlp();
  const start = Date.now();
  for (let cycle = 1; ; cycle++) {
    console.log(
      `\n═══ cycle ${cycle} · started ${duration(Date.now() - start)} ago · today so far: ${describeSpend(await todaySpendUsd())}`,
    );
    // Requests are consumed before the services are even asked about, because
    // consumption costs nothing and turns request rows into queue items. A run
    // that then fails on a sick service has still done that much.
    await consumeRequests();
    await assertServicesReady();
    // On a day whose cap is spent we still consume the request inboxes above,
    // but we do not walk the feeds. Every later dispatch of the day would
    // otherwise enqueue one more backlog item nobody can process yet.
    if (await spendCapReached()) {
      console.log(`Daily spend cap reached (${describeSpend(await todaySpendUsd())}) — not enqueueing or processing today`);
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
