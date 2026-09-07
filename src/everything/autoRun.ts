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
import { describeSpend, spendCapReached, todaySpendUsd } from "./spendCap";
import { drainQueue } from "./worker";

const RUN_TIME_BUDGET_MS = 5 * 60_000;

/** Asks both services how they are before any work starts.
 *
 * This run is also the only thing watching them. A service that cannot be
 * reached fails the run, which is how a machine that is down becomes visible
 * instead of silently doing nothing. A service whose queue is far behind is
 * left alone rather than given more work, because a backlog that long means it
 * is stuck rather than busy, and this run would only wait on it for nothing. */
async function servicesAreReady(): Promise<boolean> {
  const [claimCheck, extraction] = await Promise.all([fetchClaimCheckHealth(), fetchExtractionHealth()]);
  for (const health of [claimCheck, extraction]) {
    console.log(
      `[${health.service}] ${health.inFlight} in flight, ${health.waiting} waiting` +
        (health.oldestWaitSeconds === null ? "" : `, oldest waiting ${health.oldestWaitSeconds}s`),
    );
    if (queueIsStuck(health)) {
      console.log(`[${health.service}] queue is stuck — not adding to it this run`);
      return false;
    }
  }
  return true;
}

async function main() {
  ensureYtDlp();
  if (!(await servicesAreReady())) return;
  const start = Date.now();
  for (let cycle = 1; ; cycle++) {
    console.log(`\n––– cycle ${cycle} (${Math.round((Date.now() - start) / 1000)}s elapsed)`);
    await consumeRequests();
    // On a day whose cap is spent we still consume the request inboxes above,
    // but we do not walk the feeds. Every later dispatch of the day would
    // otherwise enqueue one more backlog item nobody can process yet.
    if (await spendCapReached()) {
      console.log(`Daily spend cap reached (${describeSpend(await todaySpendUsd())}) — not enqueueing or processing today`);
      break;
    }
    await runAutoEnqueue();
    const processed = await drainQueue();
    if (processed === 0) break;
    if (Date.now() - start >= RUN_TIME_BUDGET_MS) {
      console.log(`Time budget spent (${Math.round((Date.now() - start) / 1000)}s) — stopping after this cycle`);
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
