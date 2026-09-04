/**
 * Fills the everything_top_posts cache for every followed creator (GOO-81).
 * Each loadTopPosts call refreshes at most one stale feed, so this loops
 * until no followed feed is stale any more. It only writes the cache table
 * and the feeds' refresh stamps: nothing is enqueued and no LLM is called.
 *
 * Usage: bun run src/scripts_jim/2026_09_01_top_posts/fillTopPostCache.ts
 */

import "dotenv/config";
import { fetchFollowedFeeds } from "../../everything/db";
import { ensureYtDlp } from "../../everything/sources/youtube";
import { loadTopPosts } from "../../everything/topPosts";

ensureYtDlp();
const feedCount = (await fetchFollowedFeeds()).length;
let rows = await loadTopPosts();
for (let i = 0; i < feedCount; i++) {
  if ((await fetchFollowedFeeds()).every((f) => f.top_posts_refreshed_at !== null)) break;
  rows = await loadTopPosts();
}
console.log(`Cache holds ${rows.length} top posts across ${feedCount} followed feeds`);
