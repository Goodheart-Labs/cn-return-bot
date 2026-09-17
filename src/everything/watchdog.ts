/**
 * The watchdog run. The Everything Feed Watchdog workflow runs this every
 * half hour, started by the database (migration 102). Nothing else watches
 * the services machine, so sickness must fail this run: a red run in the
 * Actions list is how a dead or wedged machine becomes visible.
 *
 * Four things are checked. Each of the two HTTP services answers, and neither
 * one's queue is stuck. The intake service is consuming reader requests. The
 * feed worker is alive. Intake and the feed worker have no port, so both are
 * checked by their effect: an old unconsumed request means nobody is
 * listening, and an old heartbeat means the feed loop has stopped.
 *
 * Usage:
 *   bun run src/everything/watchdog.ts
 */

import "dotenv/config";
import { fetchClaimCheckHealth, fetchExtractionHealth, queueIsStuck } from "../service/client";
import { feedWorkerSilentSeconds, oldestPendingRequestAgeSeconds } from "./db";
import { duration } from "./logFormat";
import { describeSpend, todaySpendUsd } from "./spendCap";

/** How long a reader request may sit unconsumed before this run fails. Intake
 *  consumes within seconds when it is alive, and its own 60-second poll is the
 *  slowest legitimate path, so a request this old means intake is dead. */
const STALE_REQUEST_LIMIT_SECONDS = 15 * 60;

/** How long the feed worker may go without a heartbeat. Its loop beats at
 *  least every 5 minutes, and a deploy stops it for as long as its longest
 *  item takes to finish, which has been up to an hour. Two hours of silence
 *  is past both. */
const SILENT_FEED_WORKER_LIMIT_SECONDS = 2 * 3600;

async function assertServicesHealthy(): Promise<void> {
  const healths = await Promise.all([fetchClaimCheckHealth(), fetchExtractionHealth()]);
  for (const health of healths) {
    const oldest = (label: string, seconds: number | null) => (seconds === null ? "" : `, oldest ${label} ${seconds}s`);
    console.log(
      `[${health.service}] ${health.inFlight} in flight, ${health.waiting} waiting` +
        oldest("waiting", health.oldestWaitSeconds) +
        oldest("in flight", health.oldestInFlightSeconds),
    );
    if (queueIsStuck(health)) throw new Error(`The ${health.service} service is stuck. Failing the run so this is seen.`);
  }
}

async function assertIntakeConsuming(): Promise<void> {
  const requestAge = await oldestPendingRequestAgeSeconds();
  console.log(`[intake] oldest unconsumed reader request: ${requestAge === null ? "none" : duration(requestAge * 1000)}`);
  if (requestAge !== null && requestAge >= STALE_REQUEST_LIMIT_SECONDS) {
    throw new Error(`A reader request has waited ${duration(requestAge * 1000)} unconsumed, so the intake service is probably down. Failing the run so this is seen.`);
  }
}

async function assertFeedWorkerAlive(): Promise<void> {
  const silentSeconds = await feedWorkerSilentSeconds();
  console.log(`[feed] last seen: ${silentSeconds === null ? "never" : `${duration(silentSeconds * 1000)} ago`}`);
  if (silentSeconds === null || silentSeconds >= SILENT_FEED_WORKER_LIMIT_SECONDS) {
    throw new Error("The feed worker has gone quiet. Look at `journalctl -u cn-feed` on the services machine. Failing the run so this is seen.");
  }
}

async function main() {
  console.log(`today so far: ${describeSpend(await todaySpendUsd())}`);
  await assertServicesHealthy();
  await assertIntakeConsuming();
  await assertFeedWorkerAlive();
}

main().catch((err) => {
  console.error("[watchdog] Fatal error:", err);
  process.exit(1);
});
