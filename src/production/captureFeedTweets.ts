/**
 * Capture the entire eligible-posts feed into the feed_tweets table.
 *
 * Read + save only: paginates the full feed (default xxl) and saves every post
 * via bulkSaveFeedTweets — first-seen tweets get a full row incl. raw_tweet,
 * re-seen tweets only get metrics + last_seen_at refreshed. Never drafts or
 * submits anything.
 *
 * Runs manually via the capture-feed-tweets GitHub Actions workflow (prod X
 * secrets → xxl access). Env: FEED_SIZE (default xxl), MAX_PAGES (default 300 —
 * enough to exhaust the feed at 100 posts/page).
 *
 * Local smoke test (LOCAL_X_* only has small-feed access):
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
  const { inserted, updated } = await new SupabaseLogger().bulkSaveFeedTweets(posts);
  console.log(`[capture-feed] feed=${FEED_SIZE} crawled=${posts.length} new=${inserted} updated=${updated}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
