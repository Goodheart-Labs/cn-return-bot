/**
 * The intake service: the always-on caller that makes reader requests feel
 * immediate.
 *
 * It watches the everything_note_requests table, turns each request into a
 * queue item exactly as the batch consumer always has, and then processes the
 * requested tier of the queue right away, calling the extraction and
 * claim-check services like every other caller. Feed and backlog items are not
 * its business; the Actions feed run owns those tiers, which is what makes the
 * two workers unable to want the same row.
 *
 * It hears about a new request in about a second over Supabase Realtime, and
 * additionally re-reads the inbox on a timer. The timer is not optional:
 * realtime is a live feed with no replay, so a row that lands while the socket
 * is reconnecting is never re-delivered, and without the timer such a request
 * would sit forever while the reader watched a spinner.
 *
 * It has no port. The Actions feed run watches it by its effect instead: an
 * unconsumed request older than a few minutes fails that run, because intake
 * alive means requests are consumed within seconds.
 *
 *   bun run src/service/intake/main.ts
 */

import "dotenv/config";
import { getSupabaseClient } from "../../api/supabaseClient";
import { consumeNoteRequests } from "../../everything/consumeRequests";
import { claimNextQueuedItem, markRequestedQueueBudgetExhausted } from "../../everything/db";
import { clip } from "../../everything/logFormat";
import { ensureYtDlp } from "../../everything/sources/youtube";
import { describeSpend, requestBudgetExhausted, todaySpendUsd } from "../../everything/spendCap";
import { processQueuedItem } from "../../everything/worker";

/** The backstop for realtime's no-replay gap. One indexed query that almost
 *  always returns nothing. */
const POLL_INTERVAL_MS = 60_000;

/** Wakes the loop early. Realtime events and the timer both call it; the loop
 *  never cares which one did. */
let wake: () => void = () => {};

function sleepUntilWoken(): Promise<void> {
  return new Promise((resolve) => {
    wake = resolve;
    setTimeout(resolve, POLL_INTERVAL_MS);
  });
}

function subscribeToRequests(): void {
  getSupabaseClient()
    .channel("intake-note-requests")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "everything_note_requests" }, () => wake())
    .subscribe((status) => console.log(`[intake] realtime channel: ${status}`));
}

/** Consumes the inbox, then works the requested tier until it is empty or the
 *  full daily cap is reached. An item cut short by the cap goes back in the
 *  queue with its finished claims kept, and the day's budget marker tells the
 *  extension why nothing is moving. */
async function handlePendingWork(): Promise<void> {
  await consumeNoteRequests();
  for (;;) {
    if (await requestBudgetExhausted()) {
      console.log(`[intake] request budget spent (${describeSpend(await todaySpendUsd())}) — marking the queue`);
      await markRequestedQueueBudgetExhausted();
      return;
    }
    const item = await claimNextQueuedItem("requested");
    if (!item) return;
    console.log(`\n[intake] CHECKING NOW · [${item.source}] ${clip(item.title ?? item.url, 60)}`);
    const ended = await processQueuedItem(item);
    if (ended === "capped") return;
  }
}

async function main() {
  ensureYtDlp();
  subscribeToRequests();
  console.log("[intake] watching for reader requests");
  for (;;) {
    // A thrown iteration crashes the process on purpose. systemd restarts it,
    // and a crash loop is a loud signal where a swallowed error would be a
    // silent dead service.
    await handlePendingWork();
    await sleepUntilWoken();
  }
}

main().catch((err) => {
  console.error("[intake] Fatal error:", err);
  process.exit(1);
});
