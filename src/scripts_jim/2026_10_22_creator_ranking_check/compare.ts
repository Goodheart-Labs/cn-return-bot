// Compares the walk's own ranking (rankCreators) with the dashboard's database
// function, against whatever database the environment points at. Read only.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { rankCreators } from "../../everything/creatorRanking";
import { byWalkOrder, LAST_POSTS_PER_CREATOR, MIN_SCORE_TO_WALK, MIN_VISITED_POSTS_TO_WALK } from "../../everything-core/readers";
import { normalizeFeedUrl } from "../../everything-core/pageUrls";

const walk = await rankCreators();
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data, error } = await db.rpc("everything_creator_ranking", {
  last_posts: LAST_POSTS_PER_CREATOR,
  min_score: MIN_SCORE_TO_WALK,
  min_posts: MIN_VISITED_POSTS_TO_WALK,
});
if (error) throw error;
const dashboard = data
  .map((row) => ({
    prioritized: row.priority_until !== null,
    feed_url: row.feed_url,
    score: { visitors_per_post: row.visitors_per_post ?? 0, people: row.people ?? 0 },
  }))
  .sort(byWalkOrder);

const walkKeys = walk.map((c) => normalizeFeedUrl(c.feed_url));
const dashboardKeys = dashboard.map((c) => normalizeFeedUrl(c.feed_url));
console.log(`walk: ${walkKeys.length} creators, dashboard: ${dashboardKeys.length} creators`);
console.log(`walked with fewer than ${MIN_VISITED_POSTS_TO_WALK} posts and no priority: ${walk.filter((c) => !c.prioritized && c.score.posts < MIN_VISITED_POSTS_TO_WALK).length}`);
console.log(`only in walk: ${walkKeys.filter((k) => !dashboardKeys.includes(k)).join(", ") || "none"}`);
console.log(`only on dashboard: ${dashboardKeys.filter((k) => !walkKeys.includes(k)).join(", ") || "none"}`);
console.log(`same order: ${JSON.stringify(walkKeys) === JSON.stringify(dashboardKeys)}`);
