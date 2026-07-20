/**
 * Backfill `tweets` rows for misinfo-pre-pass tweets processed before the
 * fix in #282 (the pre-pass ran the pipeline but never persisted the post,
 * so the review dashboard rendered those note cards with no tweet).
 *
 * Same method as the #282 one-off backfill: every processed sighting whose
 * tweet_id has no `tweets` row gets its post recovered from the run's own
 * logs (`pipeline_runs.logs -> tweet -> post`, the verbatim Post the pipeline
 * processed) and inserted through the production path —
 * SupabaseLogger.bulkInsertNewTweets, insert-only (ignoreDuplicates), so an
 * existing row can never be overwritten and re-running is a no-op.
 *
 * DRY RUN by default: prints what it would insert. Pass --write to insert.
 *
 *   bun run src/scripts_rob/2026_07_20_backfill_misinfo_tweets/backfill.ts
 *   bun run src/scripts_rob/2026_07_20_backfill_misinfo_tweets/backfill.ts --write
 */

import { SupabaseLogger } from "../../api/supabaseClient";
import type { Post } from "../../api/fetchEligiblePosts";

const WRITE = process.argv.includes("--write");
const logger = new SupabaseLogger();

// 1. Every processed sighting (all topics — insert-only makes over-inclusion safe).
const sightings = await logger.fetchAllRows<{ tweet_id: string; topic_id: string; processed_run_id: string }>(
  (c) =>
    c
      .from("misinfo_monitoring_sightings")
      .select("id, tweet_id, topic_id, processed_run_id")
      .not("processed_run_id", "is", null),
  "id",
  "processed_sightings",
);

// 2. Which of those tweets are missing from `tweets`?
const uniqueTweetIds = [...new Set(sightings.map((s) => s.tweet_id))];
const present = new Set<string>();
for (let i = 0; i < uniqueTweetIds.length; i += 200) {
  const batch = uniqueTweetIds.slice(i, i + 200);
  const rows = await logger.fetchAllRows<{ tweet_id: string }>(
    (c) => c.from("tweets").select("tweet_id").in("tweet_id", batch),
    "tweet_id",
  );
  for (const r of rows) present.add(r.tweet_id);
}
const missing = sightings.filter((s) => !present.has(s.tweet_id));
// A tweet can be sighted under two topics → one run each; recover once.
const missingByTweet = new Map(missing.map((s) => [s.tweet_id, s]));
console.log(
  `${sightings.length} processed sightings, ${uniqueTweetIds.length} unique tweets, ` +
    `${present.size} already in tweets, ${missingByTweet.size} to backfill`,
);

// 3. Recover each missing tweet's Post from its run's logs.
const posts: Post[] = [];
const unrecoverable: string[] = [];
for (const s of missingByTweet.values()) {
  const rows = await logger.fetchAllRows<{ id: string; logs: any }>(
    (c) => c.from("pipeline_runs").select("id, logs").eq("id", s.processed_run_id),
    "id",
  );
  const post = rows[0]?.logs?.tweet?.post as Post | undefined;
  if (post?.id && post.id === s.tweet_id) {
    posts.push(post);
    console.log(`  recover ${s.tweet_id} [${s.topic_id}] @${post.author_name ?? "?"}: ${String(post.text ?? "").slice(0, 70)}`);
  } else {
    unrecoverable.push(s.tweet_id);
    console.warn(`  UNRECOVERABLE ${s.tweet_id} (run ${s.processed_run_id}: no logs.tweet.post or id mismatch)`);
  }
}

// 4. Insert through the production path (insert-only; existing rows untouched).
if (!WRITE) {
  console.log(`\nDRY RUN: would insert ${posts.length} tweets (${unrecoverable.length} unrecoverable). Re-run with --write.`);
} else {
  await logger.bulkInsertNewTweets(posts);
  console.log(`\nInserted ${posts.length} tweets (${unrecoverable.length} unrecoverable).`);
}
