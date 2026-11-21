/**
 * cn-feed-views, the feed view recorder (GOO-834). A daemon on the services
 * box, kept alive by systemd (ops/cn-feed-views.service). Every 10 minutes, on
 * the clock (:00, :10, ...), it walks the small, large and XL tiers of X's
 * eligible-posts feed (walk.ts) and stores one reading of each XL post's public
 * counts in feed_tweet_views, plus one row about the walk in feed_view_walks.
 *
 * The readings let us see how a post's views grow, and learn to predict them.
 * This is a one-time collection of at most 14 days (GOO-845).
 *
 * The first time it sees a post, it also stores the post's profile in
 * feed_view_posts: when it was posted, its author's size, its kind and its
 * text. It does not write feed_tweets. That table freezes what the X run saw
 * when it first met a post, and floor analyses replay it, so a second writer
 * would change its meaning.
 *
 * If a walk takes longer than 10 minutes, the next one starts at the next
 * full slot, so walks never pile up. A walk counts as failed when X stopped it
 * or its readings could not be stored. When an hour passes without a complete
 * and stored walk, the daemon tells Slack once, and again when walks succeed
 * again. A database error does not crash the daemon, because a crash loop would
 * keep it from ever sending that warning. The warning is the alarm instead.
 * The warning state lives in memory, so a restart during an outage, for example
 * by a deploy, can send the warning once more.
 *
 *   bun run src/feed-views/main.ts             the daemon
 *   bun run src/feed-views/main.ts --dry-run   one walk now, prints what it read, writes nothing
 */

import "dotenv/config";
import { walkEligiblePages } from "../api/fetchEligiblePosts";
import { buildPostSelection } from "../pipeline/orchestration/utils/feedSizeStrategy";
import { NOTEWRITERS_SLACK_CHANNEL, postToSlack } from "../pipeline/utils/slack";
import { lastCompleteWalkAt, savePosts, saveWalk } from "./db";
import { type RecordedTier, type WalkResult, walkFeed } from "./walk";

const WALK_INTERVAL_MS = 10 * 60_000;
const SILENCE_WARNING_MS = 60 * 60_000;
const DRY_RUN_READINGS_SHOWN = 10;

const readTier = (tier: RecordedTier) => walkEligiblePages(buildPostSelection(tier));

function describeWalk(walk: WalkResult): string {
  const seconds = Math.round((walk.finishedAt.getTime() - walk.startedAt.getTime()) / 1000);
  const { small, large, xl } = walk.postsPerTier;
  const outcome = walk.stopReason === null ? "complete" : `stopped (${walk.stopReason})`;
  return `[feed-views] walk ${outcome}: small ${small}, large ${large}, xl ${xl} posts, ${walk.pages} pages in ${seconds}s, ${walk.rateRemaining ?? "?"} requests left`;
}

/** Stores the walk and the profiles of posts not stored before. Returns null,
 *  or why the walk could not be stored. The ids already stored are kept in
 *  memory, so after a restart the first walk sends every profile once more,
 *  and the database keeps the first. */
async function storeWalk(walk: WalkResult, storedPostIds: Set<string>): Promise<string | null> {
  try {
    const newPosts = walk.readings.map((r) => r.post).filter((post) => !storedPostIds.has(post.id));
    await savePosts(newPosts);
    for (const post of newPosts) storedPostIds.add(post.id);
    await saveWalk(walk);
    return null;
  } catch (err) {
    return `database error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

type SilenceWatch = { lastSuccessAt: Date; warned: boolean };

/** failure is null for a walk that was complete and stored. */
async function watchSilence(watch: SilenceWatch, finishedAt: Date, failure: string | null): Promise<void> {
  if (failure === null) {
    if (watch.warned) await postToSlack(NOTEWRITERS_SLACK_CHANNEL, "The feed view recorder (cn-feed-views) completes and stores its walks of X's feed again.");
    watch.lastSuccessAt = finishedAt;
    watch.warned = false;
    return;
  }
  if (watch.warned || finishedAt.getTime() - watch.lastSuccessAt.getTime() < SILENCE_WARNING_MS) return;
  await postToSlack(
    NOTEWRITERS_SLACK_CHANNEL,
    `The feed view recorder (cn-feed-views) on the services box has not completed and stored a walk of X's feed since ${watch.lastSuccessAt.toISOString()}. ` +
      `The last walk failed with: ${failure}`,
  );
  watch.warned = true;
}

/** When the silence watch starts counting. A database that cannot be read at
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
  const watch: SilenceWatch = { lastSuccessAt: await startOfSilenceWatch(), warned: false };
  const storedPostIds = new Set<string>();
  console.log(`[feed-views] started; last complete walk ended ${watch.lastSuccessAt.toISOString()}`);
  for (;;) {
    const nextSlot = Math.ceil(Date.now() / WALK_INTERVAL_MS) * WALK_INTERVAL_MS;
    await Bun.sleep(nextSlot - Date.now());
    const walk = await walkFeed(readTier);
    const storeFailure = await storeWalk(walk, storedPostIds);
    console.log(`${describeWalk(walk)}${storeFailure ? `, NOT STORED: ${storeFailure}` : `, ${walk.readings.length} readings stored`}`);
    await watchSilence(watch, walk.finishedAt, storeFailure ?? walk.stopReason);
  }
}

async function dryRun(): Promise<void> {
  const walk = await walkFeed(readTier);
  console.log(describeWalk(walk));
  for (const r of walk.readings.slice(0, DRY_RUN_READINGS_SHOWN)) {
    console.log(`[feed-views]   #${r.xlRank} ${r.post.id} ${r.tier} ${r.post.public_metrics?.impression_count} views, posted ${r.post.created_at}`);
  }
}

if (process.argv.includes("--dry-run")) await dryRun();
else await runDaemon();
