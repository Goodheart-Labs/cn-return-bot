/**
 * cn-feed-views, the feed view recorder (GOO-834). A daemon on the services
 * box, kept alive by systemd (ops/cn-feed-views.service). Every 10 minutes, on
 * the clock (:00, :10, ...), it walks the small, large and XL tiers of X's
 * eligible-posts feed (walk.ts) and stores one reading of each XL post's public
 * counts in feed_tweet_views, plus one row about the walk in feed_view_walks.
 * A post it sees for the first time also gets its feed_tweets row, the same row
 * the X run writes, so the post's text and author are on record.
 *
 * The readings let us see how a post's views grow, and learn to predict them.
 * This is a one-time collection of at most 14 days (GOO-845).
 *
 * If a walk takes longer than 10 minutes, the next one starts at the next
 * full slot, so walks never pile up. When an hour passes without a complete
 * walk, the daemon tells Slack once, and again when walks complete again. A
 * database error crashes the daemon on purpose, and systemd starts it again.
 *
 *   bun run src/feed-views/main.ts             the daemon
 *   bun run src/feed-views/main.ts --dry-run   one walk now, prints what it read, writes nothing
 */

import "dotenv/config";
import { walkEligiblePages } from "../api/fetchEligiblePosts";
import { SupabaseLogger } from "../api/supabaseClient";
import { buildPostSelection } from "../pipeline/orchestration/utils/feedSizeStrategy";
import { NOTEWRITERS_SLACK_CHANNEL, postToSlack } from "../pipeline/utils/slack";
import { lastCompleteWalkAt, saveWalk } from "./db";
import { type Reading, type RecordedTier, type WalkResult, walkFeed } from "./walk";

const WALK_INTERVAL_MS = 10 * 60_000;
const SILENCE_WARNING_MS = 60 * 60_000;

const readTier = (tier: RecordedTier) => walkEligiblePages(buildPostSelection(tier));

function describeWalk(walk: WalkResult): string {
  const seconds = Math.round((walk.finishedAt.getTime() - walk.startedAt.getTime()) / 1000);
  const { small, large, xl } = walk.postsPerTier;
  const outcome = walk.stopReason === null ? "complete" : `stopped (${walk.stopReason})`;
  return `[feed-views] walk ${outcome}: small ${small}, large ${large}, xl ${xl} posts, ${walk.pages} pages in ${seconds}s, ${walk.rateRemaining ?? "?"} requests left, ${walk.readings.length} readings`;
}

/** Gives every post seen for the first time its feed_tweets row. The ids
 *  already stored are kept in memory, so after the first walk only new posts
 *  are looked up in the database. */
async function storeFirstSightings(logger: SupabaseLogger, readings: Reading[], storedIds: Set<string>): Promise<number> {
  const unseen = readings.filter((r) => !storedIds.has(r.post.id));
  const inserted = await logger.insertNewFeedTweets(unseen.map((r) => ({ post: r.post, feedSize: r.tier })));
  for (const r of unseen) storedIds.add(r.post.id);
  return inserted.size;
}

type SilenceWatch = { lastCompleteAt: Date; warned: boolean };

async function watchSilence(watch: SilenceWatch, walk: WalkResult): Promise<void> {
  if (walk.stopReason === null) {
    if (watch.warned) await postToSlack(NOTEWRITERS_SLACK_CHANNEL, "The feed view recorder (cn-feed-views) completes its walks of X's feed again.");
    watch.lastCompleteAt = walk.finishedAt;
    watch.warned = false;
    return;
  }
  if (watch.warned || walk.finishedAt.getTime() - watch.lastCompleteAt.getTime() < SILENCE_WARNING_MS) return;
  await postToSlack(
    NOTEWRITERS_SLACK_CHANNEL,
    `The feed view recorder (cn-feed-views) on the services box has not completed a walk of X's feed since ${watch.lastCompleteAt.toISOString()}. ` +
      `The last walk stopped with: ${walk.stopReason}`,
  );
  watch.warned = true;
}

async function runDaemon(): Promise<never> {
  const logger = new SupabaseLogger();
  const storedIds = new Set<string>();
  const watch: SilenceWatch = { lastCompleteAt: (await lastCompleteWalkAt()) ?? new Date(), warned: false };
  console.log(`[feed-views] started; last complete walk ended ${watch.lastCompleteAt.toISOString()}`);
  for (;;) {
    const nextSlot = Math.ceil(Date.now() / WALK_INTERVAL_MS) * WALK_INTERVAL_MS;
    await Bun.sleep(nextSlot - Date.now());
    const walk = await walkFeed(readTier);
    const firstSightings = await storeFirstSightings(logger, walk.readings, storedIds);
    await saveWalk(walk);
    console.log(`${describeWalk(walk)}, ${firstSightings} new to feed_tweets`);
    await watchSilence(watch, walk);
  }
}

async function dryRun(): Promise<void> {
  const walk = await walkFeed(readTier);
  console.log(describeWalk(walk));
  for (const r of walk.readings.slice(0, 10)) {
    console.log(`[feed-views]   #${r.xlRank} ${r.post.id} ${r.tier} ${r.post.public_metrics?.impression_count} views, posted ${r.post.created_at}`);
  }
}

if (process.argv.includes("--dry-run")) await dryRun();
else await runDaemon();
