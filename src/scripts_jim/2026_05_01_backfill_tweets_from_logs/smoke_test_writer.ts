/**
 * Smoke test the tweets-table + pipeline_runs writer path against local
 * Supabase. Doesn't call any LLM — just exercises the SupabaseLogger code
 * that processTweet uses, with a fake Post.
 *
 * Usage:
 *   bun run src/scripts_jim/2026_05_01_backfill_tweets_from_logs/smoke_test_writer.ts
 */

import "dotenv/config";

const url = process.env.LOCAL_SUPABASE_URL;
const key = process.env.LOCAL_SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("requires LOCAL_SUPABASE_URL / LOCAL_SUPABASE_SERVICE_KEY");
  process.exit(1);
}
process.env.SUPABASE_URL = url;
process.env.SUPABASE_SERVICE_KEY = key;

import { SupabaseLogger } from "../../api/supabaseClient";

const TWEET_ID = `smoke_test_${Date.now()}`;

async function main() {
  const logger = new SupabaseLogger();

  console.log(`[smoke] tweet_id=${TWEET_ID}`);

  const fakePost = {
    id: TWEET_ID,
    author_id: "smoke_author_42",
    author_name: "Smoke Test User",
    author_description: "Bio of the smoke tester",
    author_followers: 1234,
    author_tweet_count: 5678,
    text: "This is a smoke-test tweet for the schema refactor.",
    created_at: new Date().toISOString(),
    public_metrics: {
      impression_count: 9999,
      like_count: 100,
      retweet_count: 10,
      reply_count: 5,
      quote_count: 2,
      bookmark_count: 1,
    },
    media: [{ media_key: "k1", type: "photo", url: "https://example.com/photo.jpg" }],
    referenced_tweets: undefined,
    referenced_tweet_data: undefined,
  };

  await logger.upsertTweet(fakePost, {
    has_video: false,
    has_photo: true,
    media_count: 1,
    video_duration_ms: undefined,
  });
  console.log(`[smoke] upsertTweet OK`);

  const runId = await logger.createPipelineRun({
    tweet_id: TWEET_ID,
    bot_name: "smoke-bot",
    bot_name_long: "smoke-bot_smoke-variant",
    bot_config: { configName: "smoke-variant", model: "smoke/model" },
    commit_sha: "smoke-commit",
  });
  console.log(`[smoke] createPipelineRun OK → ${runId}`);

  await logger.completePipelineRun(runId, {
    outcome: "candidate",
    final_stage: "candidate",
    bot_name: "smoke-bot",
    bot_name_long: "smoke-bot_smoke-variant",
    bot_config: { configName: "smoke-variant", model: "smoke/model" },
    note_text: "smoke note text",
    source_url: "https://example.com",
    note_status: "CORRECTION WITH TRUSTWORTHY CITATION",
    logs: { tweet: { id: TWEET_ID, text: "smoke" } },
  });
  console.log(`[smoke] completePipelineRun OK`);

  // Verify both rows are visible and joinable.
  // @ts-expect-error — using the supabase client directly
  const supa = logger["client"];
  const { data: tweet } = await supa.from("tweets").select("*").eq("tweet_id", TWEET_ID).single();
  const { data: run } = await supa.from("pipeline_runs").select("*").eq("id", runId).single();

  if (!tweet) throw new Error("tweets row missing");
  if (!run) throw new Error("pipeline_runs row missing");
  if (tweet.author_name !== fakePost.author_name) throw new Error(`author_name mismatch: ${tweet.author_name}`);
  if (run.bot_name !== "smoke-bot") throw new Error(`bot_name mismatch: ${run.bot_name}`);
  if (run.bot_config?.configName !== "smoke-variant") throw new Error(`bot_config.configName mismatch`);
  if (run.outcome !== "candidate") throw new Error(`outcome mismatch: ${run.outcome}`);

  console.log(`[smoke] verified — tweets row + pipeline_runs row both present and correctly populated`);

  // Cleanup so the test is idempotent
  await supa.from("pipeline_runs").delete().eq("id", runId);
  await supa.from("tweets").delete().eq("tweet_id", TWEET_ID);
  console.log(`[smoke] cleanup done`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
