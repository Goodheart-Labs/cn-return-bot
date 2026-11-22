/** The feed view recorder's writes (migration 193). A failed write throws.
 *  The daemon counts that walk as failed (main.ts). */

import { getSupabaseClient } from "../api/supabaseClient";
import type { WalkResult } from "./walk";

/** The rows are narrow, so a chunk of this size stays far below PostgREST's
 *  body limit while keeping a walk to about 7 requests. */
const VIEWS_WRITE_CHUNK = 1000;

/** Stores the readings first and the walk row last, so a walk row always
 *  means that its readings are in. */
export async function saveWalk(walk: WalkResult): Promise<void> {
  const client = getSupabaseClient();
  const rows = walk.readings.map(({ post, observedAt, tier, xlRank }) => ({
    tweet_id: post.id,
    observed_at: observedAt.toISOString(),
    impressions: post.public_metrics?.impression_count,
    likes: post.public_metrics?.like_count,
    retweets: post.public_metrics?.retweet_count,
    replies: post.public_metrics?.reply_count,
    quotes: post.public_metrics?.quote_count,
    bookmarks: post.public_metrics?.bookmark_count,
    tier,
    xl_rank: xlRank,
  }));
  for (let i = 0; i < rows.length; i += VIEWS_WRITE_CHUNK) {
    const { error } = await client.from("feed_tweet_views").insert(rows.slice(i, i + VIEWS_WRITE_CHUNK));
    if (error) throw new Error(`Could not store feed view readings: ${error.message}`);
  }

  const { error } = await client.from("feed_view_walks").insert({
    started_at: walk.startedAt.toISOString(),
    finished_at: walk.finishedAt.toISOString(),
    complete: walk.stopReason === null,
    stop_reason: walk.stopReason,
    small_posts: walk.postsPerTier.small,
    large_posts: walk.postsPerTier.large,
    xl_posts: walk.postsPerTier.xl,
    pages: walk.pages,
    rate_remaining: walk.rateRemaining,
  });
  if (error) throw new Error(`Could not store the feed view walk: ${error.message}`);
}

/** When the last complete walk ended, or null if there was none. The silence
 *  warning starts counting from here, so a restart does not reset it. */
export async function lastCompleteWalkAt(): Promise<Date | null> {
  const { data, error } = await getSupabaseClient()
    .from("feed_view_walks")
    .select("finished_at")
    .eq("complete", true)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read the last feed view walk: ${error.message}`);
  return data ? new Date(data.finished_at) : null;
}
