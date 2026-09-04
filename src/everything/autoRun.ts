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
import { runAutoEnqueue } from "./autoEnqueue";
import { consumeRequests } from "./consumeRequests";
import { ensureYtDlp } from "./sources/youtube";
import { duration } from "./logFormat";
import { describeSpend, spendCapReached, todaySpendUsd } from "./spendCap";
import { drainQueue } from "./worker";

const RUN_TIME_BUDGET_MS = 5 * 60_000;

async function main() {
  ensureYtDlp();
  const start = Date.now();
  for (let cycle = 1; ; cycle++) {
    console.log(
      `\n═══ cycle ${cycle} · started ${duration(Date.now() - start)} ago · today so far: ${describeSpend(await todaySpendUsd())}`,
    );
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
