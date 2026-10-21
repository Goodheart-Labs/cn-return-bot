// For every post our prod pipeline finished after a given moment, looks up its
// creator's score, the average number of distinct readers per post over their
// 10 most recently visited posts. Prints the posts and a histogram (GOO-495).
//
// Usage: bun run src/scripts_jim/2026_10_21_nathan_claude_code_notes/creatorScoresSince.ts <ISO time>
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const LAST_POSTS_PER_CREATOR = 10;
const BIN_EDGES = [0, 1, 1.5, 2, 3, 5, 10, 20, Infinity];

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const since = process.argv[2];
if (!since) throw new Error("Pass the start time as an ISO timestamp");

const creatorKey = (feedUrl: string) => feedUrl.replace(/\/+$/, "").toLowerCase();

const { data: items, error } = await db
  .from("everything_items")
  .select("url, title, status, priority, processed_at, project:everything_projects(slug, feed_url)")
  .gte("processed_at", since)
  .order("processed_at")
  .limit(1000);
if (error) throw error;

const { data: scores, error: scoreError } = await db.rpc("everything_creator_visit_scores", { last_posts: LAST_POSTS_PER_CREATOR });
if (scoreError) throw scoreError;
const scoreByCreator = new Map((scores as { feed_url: string; visitors_per_post: number }[]).map((s) => [creatorKey(s.feed_url), s.visitors_per_post]));

const rows = items.map((item) => {
  const project = item.project as unknown as { slug: string; feed_url: string | null } | null;
  const score = project?.feed_url ? (scoreByCreator.get(creatorKey(project.feed_url)) ?? 0) : null;
  return { processedAt: item.processed_at as string, status: item.status, tier: item.priority, slug: project?.slug ?? "?", score, url: item.url };
});

for (const r of rows) {
  console.log(`${r.processedAt.slice(0, 16)}  tier ${r.tier}  ${r.status.padEnd(5)}  ${(r.score === null ? "no feed" : r.score.toFixed(2)).padStart(7)}  ${r.slug.padEnd(22)} ${r.url.slice(0, 80)}`);
}

console.log(`\n${rows.length} posts finished since ${since}. Creator score histogram:`);
const noFeed = rows.filter((r) => r.score === null).length;
if (noFeed) console.log(`  no creator feed          ${"#".repeat(noFeed)} ${noFeed}`);
for (let i = 0; i + 1 < BIN_EDGES.length; i++) {
  const [low, high] = [BIN_EDGES[i], BIN_EDGES[i + 1]];
  const count = rows.filter((r) => r.score !== null && r.score >= low && r.score < high).length;
  const label = high === Infinity ? `${low} or more` : `${low} to under ${high}`;
  console.log(`  ${label.padEnd(24)} ${"#".repeat(count)} ${count}`);
}
