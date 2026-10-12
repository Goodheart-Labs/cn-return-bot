/**
 * Experiment 11: fetch the Scott Alexander story from Jim's "Today's News" panel
 * by its id (from https://x.com/i/trending/2105813967801070019) and look at its
 * cluster posts. Questions: does the News API hold the panel's stories, and do
 * the cluster posts link the article the story is about?
 * Lookup by id answers 503 under user authentication (experiment 12), so it uses the app.
 * Cost: one story ($0.005) plus up to 10 posts ($0.005 each).
 */
import { xGet } from "./x";

const STORY_ID = "2105813967801070019";

const story = await xGet(
  `/2/news/${STORY_ID}`,
  { "news.fields": "name,summary,hook,category,contexts,keywords,cluster_posts_results,updated_at" },
  "app",
  "11_story",
);
const data = story.body.data;
console.log(`status ${story.status}: ${data?.name}`);
console.log(`category ${data?.category}, updated ${data?.updated_at}, topics ${data?.contexts?.topics?.join(", ")}`);
console.log(`keywords ${JSON.stringify(data?.keywords)}`);
console.log(`${data?.cluster_posts_results?.length ?? 0} cluster posts`);

const ids = (data?.cluster_posts_results ?? []).map((p: { post_id: string }) => p.post_id).join(",");
if (ids) {
  const posts = await xGet(
    "/2/tweets",
    { ids, "tweet.fields": "created_at,public_metrics,entities,referenced_tweets", expansions: "author_id", "user.fields": "username,public_metrics" },
    "app",
    "11_cluster_posts",
  );
  const users = new Map((posts.body.includes?.users ?? []).map((u: any) => [u.id, u]));
  for (const p of posts.body.data ?? []) {
    const author: any = users.get(p.author_id);
    const links = (p.entities?.urls ?? []).map((u: any) => u.unwound_url ?? u.expanded_url).join(" ");
    const kinds = (p.referenced_tweets ?? []).map((r: any) => r.type).join(",") || "original";
    const m = p.public_metrics;
    console.log(`  @${author?.username} (${author?.public_metrics?.followers_count} followers) ${kinds} likes=${m.like_count} rt=${m.retweet_count} q=${m.quote_count} links: ${links || "none"}`);
  }
}
