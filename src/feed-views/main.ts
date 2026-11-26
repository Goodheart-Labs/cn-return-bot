/**
 * cn-feed-views, the X feed daemon (GOO-834). A daemon on the services box,
 * kept alive by systemd (ops/cn-feed-views.service). Every 10 minutes, on the
 * clock (:00, :10, ...), it walks the small, large and XL tiers of X's
 * eligible-posts feed with the first account's keys (walk.ts), then
 *   1. scores each XL post: its predicted views still to come, from the speed
 *      since the walk before (src/pipeline/utils/viewsToCome.ts),
 *   2. stores one reading of each XL post's public counts with its score in
 *      feed_tweet_views, one row about the walk in feed_view_walks, and the
 *      full row of each post it sees for the first time in feed_tweets (author,
 *      text, media, the raw X answer). Everything is kept for good,
 *   3. hands the walk to the X note writer of the first account (src/x-notes/),
 *      which submits queued notes, runs the Pangram pass, and hands the best
 *      new posts to the Claude note writer on the runner.
 * The writer ran here from GOO-865 on. GOO-874 stopped it, and GOO-880
 * brought it back with Claude Code notes and Pangram notes only.
 *
 * The walk before is kept in memory. After a restart, the first walk reads it
 * from the database.
 *
 * If a walk takes longer than 10 minutes, the next one starts at the next full
 * slot, so walks never pile up. A walk counts as failed when X stopped it or it
 * could not be stored. When an hour passes without a complete and stored walk,
 * or without a round of the note writer that finished, the daemon tells Slack
 * once, and again when it works again. A database error does not crash the
 * daemon, because a crash loop would keep it from ever sending that warning.
 * The warning state lives in memory, so a restart during an outage, for
 * example by a deploy, can send the warning once more.
 *
 *   bun run src/feed-views/main.ts             the daemon
 *   bun run src/feed-views/main.ts --dry-run   one walk now: prints how many posts it scored and the best ones, writes nothing
 */

import "dotenv/config";
import { walkEligiblePages } from "../api/fetchEligiblePosts";
import { SupabaseLogger } from "../api/supabaseClient";
import { currentXAccount } from "../api/xAccount";
import { syncAbTests } from "../pipeline/ab-testing/syncAbTests";
import { buildPostSelection, type FeedSize } from "../pipeline/orchestration/utils/feedSizeStrategy";
import { NOTEWRITERS_SLACK_CHANNEL, postToSlack } from "../pipeline/utils/slack";
import { formatViewsToCome, readingsOf, scoreReadings, type ViewReading } from "../pipeline/utils/viewsToCome";
import { XNoteWriter } from "../x-notes/writer";
import { lastCompleteWalkAt, saveWalk } from "./db";
import { type WalkResult, walkFeed } from "./walk";

const WALK_INTERVAL_MS = 10 * 60_000;
const SILENCE_WARNING_MS = 60 * 60_000;
/** After a restart, the walk before is the newest stored one that started
 *  this long before the new walk. */
const EARLIER_WALK_MIN_GAP_MS = 5 * 60_000;
const EARLIER_WALK_MAX_GAP_MS = 20 * 60_000;
const DRY_RUN_POSTS_SHOWN = 15;

if (currentXAccount() !== "stilt") throw new Error("cn-feed-views reads the feed and writes the notes of the first account, stilt. Leave X_ACCOUNT unset.");
const logger = new SupabaseLogger();
const tellSlack = (text: string) => postToSlack(NOTEWRITERS_SLACK_CHANNEL, `[cn-feed-views] ${text}`);
const readTier = (tier: FeedSize) => walkEligiblePages(buildPostSelection(tier));

function describeWalk(walk: WalkResult): string {
  const seconds = Math.round((walk.finishedAt.getTime() - walk.startedAt.getTime()) / 1000);
  const { small, large, xl } = walk.postsPerTier;
  const outcome = walk.stopReason === null ? "complete" : `stopped (${walk.stopReason})`;
  return `[feed-views] walk ${outcome}: small ${small}, large ${large}, xl ${xl} posts, then ${walk.xxlReadings.length} more posts on ${walk.xxlPages} xxl pages (${walk.xxlStop}), ${walk.pages} pages in ${seconds}s, ${walk.rateRemaining ?? "?"} requests left`;
}

/** The readings of the stored walk before this one, for the first walk after a restart. */
async function storedEarlierReadings(walk: WalkResult): Promise<Map<string, ViewReading>> {
  const start = walk.startedAt.getTime();
  const earlier = await logger.findRecorderWalk(new Date(start - EARLIER_WALK_MAX_GAP_MS), new Date(start - EARLIER_WALK_MIN_GAP_MS));
  return earlier ? logger.getRecordedViews(walk.readings.map((r) => r.post.id), earlier) : new Map();
}

/** Stores the posts not stored before, then the walk with its scores. Returns
 *  null, or why that failed. The ids already stored are kept in memory, so
 *  after a restart the first walk asks the database about every post once. */
async function storeWalk(walk: WalkResult, scores: Map<string, number | null>, storedPostIds: Set<string>): Promise<string | null> {
  try {
    const newReadings = walk.readings.filter((r) => !storedPostIds.has(r.post.id));
    await logger.insertNewFeedTweets(newReadings.map((r) => ({ post: r.post, feedSize: r.tier })));
    for (const r of newReadings) storedPostIds.add(r.post.id);
    await saveWalk(walk, scores);
    return null;
  } catch (err) {
    return `database error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Tells Slack once when `what` has not worked for an hour, and once when it works again. */
class SilenceWatch {
  private warned = false;
  constructor(private readonly what: string, private lastSuccessAt: Date) {}

  /** failure is null when it worked. */
  async record(at: Date, failure: string | null): Promise<void> {
    if (failure === null) {
      if (this.warned) await tellSlack(`${this.what} works again.`);
      this.lastSuccessAt = at;
      this.warned = false;
      return;
    }
    if (this.warned || at.getTime() - this.lastSuccessAt.getTime() < SILENCE_WARNING_MS) return;
    await tellSlack(`${this.what} has not worked since ${this.lastSuccessAt.toISOString()}. The last attempt failed with: ${failure}`);
    this.warned = true;
  }
}

/** When the walk watch starts counting. A database that cannot be read at
 *  startup counts from now, and the first walk's write then fails the same
 *  way and starts the hour towards the warning. */
async function startOfSilenceWatch(): Promise<Date> {
  try {
    return (await lastCompleteWalkAt()) ?? new Date();
  } catch (err) {
    console.error("[feed-views] could not read the last complete walk:", err);
    return new Date();
  }
}

async function runDaemon(): Promise<never> {
  const walks = new SilenceWatch("Walking and storing X's feed", await startOfSilenceWatch());
  const writing = new SilenceWatch("The X note writer", new Date());
  const writer = new XNoteWriter(logger, tellSlack);
  const storedPostIds = new Set<string>();
  let before: Map<string, ViewReading> | null = null;
  // The notewriter page counts runs from before a test existed as its default
  // arm, so every test of AB_TESTS must be in x_ab_tests. A deploy restarts
  // the daemon, so syncing at start catches every new test.
  await syncAbTests().catch((err) => console.error("[x-notes] could not sync the A/B tests:", err));
  console.log("[feed-views] started");
  for (;;) {
    const nextSlot = Math.ceil(Date.now() / WALK_INTERVAL_MS) * WALK_INTERVAL_MS;
    await Bun.sleep(nextSlot - Date.now());
    const walk = await walkFeed(readTier);
    let scores = new Map<string, number | null>();
    let failure: string | null;
    try {
      scores = scoreReadings([...walk.readings, ...walk.xxlReadings], before ?? (await storedEarlierReadings(walk)));
      failure = await storeWalk(walk, scores, storedPostIds);
    } catch (err) {
      failure = `could not read the walk before: ${err instanceof Error ? err.message : String(err)}`;
    }
    // The XXL readings are never stored, so after a restart the first walk
    // gives the posts that are only in XXL no score.
    before = readingsOf([...walk.readings, ...walk.xxlReadings]);
    const scored = [...scores.values()].filter((v) => v !== null).length;
    console.log(`${describeWalk(walk)}${failure ? `, NOT STORED: ${failure}` : `, ${walk.readings.length} readings stored, ${scored} scored`}`);
    await walks.record(walk.finishedAt, failure ?? walk.stopReason);
    if (failure) continue;
    try {
      await writer.afterWalk(walk, scores);
      await writing.record(new Date(), null);
    } catch (err) {
      console.error("[x-notes] the round failed:", err);
      await writing.record(new Date(), err instanceof Error ? err.message : String(err));
    }
  }
}

async function dryRun(): Promise<void> {
  const walk = await walkFeed(readTier);
  console.log(describeWalk(walk));
  const scores = scoreReadings(walk.readings, await storedEarlierReadings(walk));
  const best = walk.readings
    .map((reading) => ({ ...reading, viewsToCome: scores.get(reading.post.id) ?? null }))
    .filter((s) => s.viewsToCome !== null)
    .sort((a, b) => b.viewsToCome! - a.viewsToCome!);
  console.log(`[feed-views] ${best.length} of ${walk.readings.length} posts scored; the best:`);
  for (const s of best.slice(0, DRY_RUN_POSTS_SHOWN)) {
    console.log(`[feed-views]   https://x.com/i/status/${s.post.id} ${s.tier} to come=${formatViewsToCome(s.viewsToCome)}`);
  }
}

if (process.argv.includes("--dry-run")) await dryRun();
else await runDaemon();
