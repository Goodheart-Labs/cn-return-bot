/**
 * Runs enqueue-and-process cycles until a time budget runs out. This is what
 * the Everything Priority Feeds workflow runs. Each cycle enqueues the next
 * unprocessed priority-feed items, BATCH_SIZE of them, and then drains the
 * queue. A new cycle only starts while the total elapsed time is still under
 * the budget. A quick item such as an ACX open thread takes about 3 minutes,
 * so several of them fit into one 30-minute dispatch slot instead of wasting
 * it. A long item is never cut short. It runs to completion even past the
 * budget.
 *
 * We stop when a cycle drained nothing from the queue. We deliberately do not
 * stop when nothing new was enqueued. That way an item that autoEnqueue's
 * triage put back in the queue is still processed.
 *
 * Usage:
 *   bun run src/everything/autoRun.ts
 */

import "dotenv/config";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { runAutoEnqueue } from "./autoEnqueue";
import { ensureYtDlp } from "./sources/youtube";
import { drainQueue } from "./worker";

const RUN_TIME_BUDGET_MS = 5 * 60_000;

async function main() {
  ensureYtDlp();
  const start = Date.now();
  for (let cycle = 1; ; cycle++) {
    console.log(`\n––– cycle ${cycle} (${Math.round((Date.now() - start) / 1000)}s elapsed)`);
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
