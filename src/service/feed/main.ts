/**
 * The feed worker: the always-on program that checks the posts and videos of
 * the creators readers care about. It runs on the services machine next to
 * the intake service, and it replaced the GitHub Actions run that started a
 * fresh machine for every single post (GOO-169). That run spent about a
 * quarter of the day on being dispatched and setting itself up, and it could
 * only ever work one post at a time while the claim checker sat idle.
 *
 * The worker is one loop (feedLoop.ts). On every pass it records that it is alive, and if
 * it has a free slot it asks the pacing rule (src/everything/pacing.ts)
 * whether a post is due. When one is, it walks the creators for a new post
 * unless something is already queued, takes the next item, and starts it
 * without waiting for it to finish. Then it sleeps until the next post is
 * due, an item finishes, or a few minutes have passed, whichever comes first.
 *
 * So the pacing rule still spaces the starts across the day exactly as it did.
 * What changed is that a post which outlasts its interval no longer holds the
 * next one back: up to MAX_ITEMS_IN_FLIGHT posts run side by side, and while
 * one waits for its claims to be extracted another has its claims checked.
 *
 * It takes only the feed tiers of the queue. Reader requests belong to the
 * intake service, which is what makes the two workers unable to want the same
 * row.
 *
 * It has no port. The watchdog run on GitHub checks it by its heartbeat in
 * the database and fails when the worker has gone quiet.
 *
 *   bun run src/service/feed/main.ts
 */

import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import { retryErroredItems, runAutoEnqueue, triageQueue } from "../../everything/autoEnqueue";
import { claimNextQueuedItem, fetchFeedPacing, recordFeedWorkerSeen, type EverythingItem } from "../../everything/db";
import { clip } from "../../everything/logFormat";
import { affordablePostsPerDay, computeNextRun, describeFeedStart, describePacing, IDLE_RECHECK_MS, MEAN_COST_RULE, nextFeedStart } from "../../everything/pacing";
import { ensureYtDlp } from "../../everything/sources/youtube";
import { describeSpend, FEED_BUDGET_USD, feedBudgetExhausted, todaySpendUsd } from "../../everything/spendCap";
import { feedItemsQueued, logQueue, processQueuedItem } from "../../everything/worker";
import { numberFromEnv } from "../serve";
import { createFeedLoop } from "./feedLoop";

/** How many posts are worked side by side. One post keeps the claim checker's
 *  feed slots busy only during its checking phase, about half its life; three
 *  keep them busy through each other's extraction and rating. Measured need,
 *  not machine size, sets this: the machine waits on the network all day. */
const DEFAULT_MAX_ITEMS_IN_FLIGHT = 3;
const MAX_ITEMS_IN_FLIGHT = numberFromEnv("FEED_MAX_ITEMS_IN_FLIGHT", DEFAULT_MAX_ITEMS_IN_FLIGHT);

/** The longest the loop sleeps in one go, which is how often the heartbeat is
 *  written. The watchdog's limit sits well above it. */
const MAX_SLEEP_MS = 5 * 60_000;

/** The longest the worker goes without asking the pacing rule again, however
 *  far away the rule said the next post is. The answer can move: a reader's
 *  page changes the day's spend, and midnight resets the budget. The heartbeat
 *  wakes the loop far more often than this, and those wake-ups must not each
 *  cost a pacing query, which reads every recent post's cost rows. */
const MAX_PACING_ANSWER_AGE_MS = IDLE_RECHECK_MS;

/** Which item a log line belongs to. Several items log at once, and without a
 *  tag their lines interleave into something nobody can read. The tag travels
 *  with the item's asynchronous work, so no function has to pass it along. */
const itemTag = new AsyncLocalStorage<string>();

function tagLogLines(): void {
  for (const level of ["log", "warn", "error"] as const) {
    const plain = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const tag = itemTag.getStore();
      plain(...(tag ? [`[${tag}]`, ...args] : args));
    };
  }
}

/** Starts the next feed item if the pacing rule says one is due. Returns how
 *  long the answer holds: how long until the rule has to be asked again. */
async function startItemIfDue(start: (item: EverythingItem) => void): Promise<number> {
  await retryErroredItems();
  if (await feedBudgetExhausted()) {
    console.log(`Feed budget reached (${describeSpend(await todaySpendUsd())}) · nothing more today`);
    return MAX_PACING_ANSWER_AGE_MS;
  }
  const snapshot = await fetchFeedPacing(MEAN_COST_RULE);
  const nextRun = computeNextRun(snapshot, FEED_BUDGET_USD);
  const feedStart = nextFeedStart(nextRun, snapshot);
  console.log(`\n${describePacing(nextRun, snapshot, FEED_BUDGET_USD)}\n${describeFeedStart(feedStart)}`);
  if (feedStart.type !== "due") return feedStart.waitMs;

  // The walk for new posts runs only when the feed tiers of the queue are
  // empty. A fresh pick is newer and would otherwise be taken before a
  // resumed or retried item every time, and those would never get their turn.
  if (!feedItemsQueued(await logQueue())) await runAutoEnqueue(affordablePostsPerDay(nextRun.meanPostCostUsd, FEED_BUDGET_USD));
  const item = await claimNextQueuedItem("feed");
  if (!item) {
    console.log("Nothing to process · every creator we walk is caught up");
    return IDLE_RECHECK_MS;
  }
  start(item);
  // The start moved the pacing marker, so the next look computes the wait.
  return 0;
}

async function main() {
  ensureYtDlp();
  tagLogLines();
  console.log(`[feed] starting · up to ${MAX_ITEMS_IN_FLIGHT} posts side by side · today so far: ${describeSpend(await todaySpendUsd())}`);
  // Nothing is in flight yet, so every feed item still marked as processing
  // was stranded by the previous worker.
  await triageQueue();
  const loop = createFeedLoop({
    maxItemsInFlight: MAX_ITEMS_IN_FLIGHT,
    maxSleepMs: MAX_SLEEP_MS,
    maxPacingAnswerAgeMs: MAX_PACING_ANSWER_AGE_MS,
    recordSeen: recordFeedWorkerSeen,
    startItemIfDue: (start) =>
      startItemIfDue((item) =>
        start(() =>
          itemTag.run(item.id.slice(0, 8), async () => {
            console.log(`CHECKING NOW · [${item.source}] ${clip(item.title ?? item.url, 60)}`);
            // An item's own failures are recorded on the item inside
            // processQueuedItem. What throws out of it is the recording
            // itself failing, which stops the loop.
            await processQueuedItem(item);
          }),
        ),
      ),
  });
  // The deploy script stops the worker with SIGTERM, because a worker that is
  // never idle would otherwise never let a deploy through. It finishes what
  // is in flight, starts nothing new, and exits.
  process.on("SIGTERM", () => {
    console.log("[feed] asked to stop · finishing what is in flight, starting nothing new");
    loop.drain();
  });
  await loop.run();
  console.log("[feed] stopped with nothing in flight");
}

// A thrown pass crashes the process on purpose. systemd restarts it, the
// start-up triage resumes whatever was in flight, and a crash loop is a loud
// signal where a swallowed error would be a silently dead worker.
main().catch((err) => {
  console.error("[feed] Fatal error:", err);
  process.exit(1);
});
