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
 * It also answers readers' Ask Opus questions (passageQuestions.ts) and works
 * the jobs the website writes for minisites (minisiteJobs.ts), each in a loop
 * of its own.
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
import { consumeMinisiteJobs } from "./minisiteJobs";
import { consumePassageQuestions } from "./passageQuestions";
import { getSupabaseClient } from "../../api/supabaseClient";
import { consumeNoteRequests } from "../../everything/consumeRequests";
import { triageOrphanedItems } from "../../everything/autoEnqueue";
import { claimNextQueuedItem, markRequestedQueueBudgetExhausted } from "../../everything/db";
import { clip } from "../../everything/logFormat";
import { ensureYtDlp } from "../../everything/sources/youtube";
import { describeTodaySpend, requestBudgetExhausted } from "../../everything/spendCap";
import { processQueuedItem } from "../../everything/worker";
import { FETCH_SERVICE_SOCKET_VARIABLE } from "../contract";
import { requiredEnv } from "../serve";

/** The backstop for realtime's no-replay gap. One indexed query that almost
 *  always returns nothing. */
const POLL_INTERVAL_MS = 60_000;

/** Wakes the loop early. Realtime events and the timer both call it; the loop
 *  never cares which one did. */
let wake: () => void = () => {};
let wakeQuestions: () => void = () => {};
let wakeMinisiteJobs: () => void = () => {};

function sleepUntilWoken(): Promise<void> {
  return new Promise((resolve) => {
    wake = resolve;
    setTimeout(resolve, POLL_INTERVAL_MS);
  });
}

/** Sleeps for the poll interval, or until the waker handed to `setWaker` is
 *  called. */
function sleepUntilPolled(setWaker: (waker: () => void) => void): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, POLL_INTERVAL_MS);
    setWaker(() => { clearTimeout(timer); resolve(); });
  });
}

function subscribeToRequests(): void {
  getSupabaseClient()
    .channel("intake-note-requests")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "everything_note_requests" }, () => wake())
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "everything_passage_questions" }, () => wakeQuestions())
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "everything_minisite_jobs" }, () => wakeMinisiteJobs())
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
      console.log(`[intake] request budget spent (${await describeTodaySpend()}) — marking the queue`);
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
  // On the services machine, outside pages and images are fetched only by the
  // sandboxed fetcher. A service started without its socket would fetch them in
  // this process, next to our keys, so it refuses to start instead.
  requiredEnv(FETCH_SERVICE_SOCKET_VARIABLE);
  ensureYtDlp();
  // The intake service is the only worker of the requested tier, so at start
  // nothing can still be checking an item of that tier that sits in
  // processing. A previous run of this service left it there.
  await triageOrphanedItems("requested");
  subscribeToRequests();
  console.log("[intake] watching for reader requests");
  await Promise.all([questionLoop(), minisiteJobLoop(), noteLoop()]);
}

async function questionLoop() {
  for (;;) {
    await consumePassageQuestions();
    await sleepUntilPolled((waker) => { wakeQuestions = waker; });
  }
}

/** A fact-check job wakes the note loop, which then works the article the
 *  job's database function already queued. Reading a page can take minutes,
 *  so these jobs have their own loop and never hold up reader requests. */
async function minisiteJobLoop() {
  for (;;) {
    await consumeMinisiteJobs(() => wake());
    await sleepUntilPolled((waker) => { wakeMinisiteJobs = waker; });
  }
}

async function noteLoop() {
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
