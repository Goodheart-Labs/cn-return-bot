/**
 * Time-budgeted enqueue→process cycles — what the Everything Priority Feeds
 * workflow runs. Each cycle enqueues the next unprocessed priority-feed item
 * (BATCH_SIZE per cycle) and drains the queue; another cycle starts only while
 * total elapsed time is under the budget, so quick items (an ACX open thread
 * takes ~3 min) don't waste a whole 30-min dispatch slot, while a long item
 * still runs to completion past the budget.
 *
 * The stop signal is "the queue drained nothing" — not "nothing was enqueued" —
 * so a requeued orphan (see autoEnqueue's triage) is processed even when no new
 * item was picked.
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
