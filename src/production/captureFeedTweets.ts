/**
 * Capture the entire eligible-posts feed into the feed_tweets table.
 *
 * This script only reads and saves. It pages through the whole feed, which
 * defaults to the xxl size, and saves every post with bulkSaveFeedTweets. A
 * tweet seen for the first time gets a full row, including its raw_tweet. A
 * tweet we have seen before only gets its metrics and its last_seen_at
 * refreshed. Nothing is ever drafted or submitted.
 *
 * It runs manually through the capture-feed-tweets GitHub Actions workflow,
 * which supplies the production X secrets. Those are the credentials with xxl
 * feed access. Two environment variables configure it. FEED_SIZE defaults to
 * xxl. MAX_PAGES defaults to 300, which is enough to exhaust the feed at 100
 * posts per page.
 *
 * For a local smoke test run the command below. The LOCAL_X_* credentials only
 * have access to the small feed.
 *   bun run src/production/captureFeedTweets.ts --local
 */

import { fetchEligiblePosts } from "../api/fetchEligiblePosts";
import { SupabaseLogger } from "../api/supabaseClient";
import { buildPostSelection, type FeedSize } from "../pipeline/orchestration/utils/feedSizeStrategy";

if (process.argv.includes("--local")) {
  process.env.X_API_KEY = process.env.LOCAL_X_API_KEY;
  process.env.X_API_KEY_SECRET = process.env.LOCAL_X_API_KEY_SECRET;
  process.env.X_ACCESS_TOKEN = process.env.LOCAL_X_ACCESS_TOKEN;
  process.env.X_ACCESS_TOKEN_SECRET = process.env.LOCAL_X_ACCESS_TOKEN_SECRET;
  process.env.SUPABASE_URL = process.env.LOCAL_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_KEY = process.env.LOCAL_SUPABASE_SERVICE_KEY;
}

const FEED_SIZE = (process.env.FEED_SIZE as FeedSize) ?? "xxl";
const MAX_PAGES = process.env.MAX_PAGES ? Number(process.env.MAX_PAGES) : 300;
const POSTS_PER_PAGE = 100;

async function main() {
  const posts = await fetchEligiblePosts(
    MAX_PAGES * POSTS_PER_PAGE,
    new Set(),
    MAX_PAGES,
    buildPostSelection(FEED_SIZE),
  );
  const { inserted, updated } = await new SupabaseLogger().bulkSaveFeedTweets(posts, FEED_SIZE);
  console.log(`[capture-feed] feed=${FEED_SIZE} crawled=${posts.length} new=${inserted} updated=${updated}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
