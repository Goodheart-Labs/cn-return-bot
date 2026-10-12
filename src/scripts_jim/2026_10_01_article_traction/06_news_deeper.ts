/**
 * Experiment 6: a closer look at X's News search, after Jim's own "Today's News"
 * panel on 2026-10-02 showed crowd stories such as "Scott Alexander Compares AI
 * Safety Critics to Early Christian Persecutors" (2,777 posts).
 *
 * Questions, each answered with a handful of stories at $0.005 each:
 * 1. Does the API serve the same story as the panel?
 * 2. Are results personalized when we call as a user (@JimMaar1) instead of as the app?
 * 3. Is the query a keyword match or a semantic one? We compare a name, a topic
 *    phrase, an OR list and a vague description of the crowd.
 * 4. Do a story's cluster posts carry the article link the story is about?
 */
import { xGet } from "./x";

const FIELDS = "name,summary,hook,category,contexts,keywords,cluster_posts_results,updated_at";
const STORIES_PER_QUERY = 5;

async function news(label: string, query: string, auth: "app" | "user") {
  const result = await xGet("/2/news/search", { query, max_results: STORIES_PER_QUERY, max_age_hours: 48, "news.fields": FIELDS }, auth, `06_news_${label}`);
  console.log(`\n${label} [${query}] as ${auth}: ${result.status}, ${result.body.data?.length ?? 0} stories`);
  for (const story of result.body.data ?? []) console.log(`  ${story.id} ${story.name} | topics: ${story.contexts?.topics?.join(", ")}`);
  return result.body.data ?? [];
}

const scottApp = await news("scott_app", "Scott Alexander", "app");
await news("scott_user", "Scott Alexander", "user");
await news("topic", "AI safety critics", "app");
await news("or_list", "rationalist OR \"effective altruism\" OR LessWrong OR forecasting", "app");
await news("vague", "stories that rationalists and effective altruists are discussing", "app");

const story = scottApp[0];
if (story) {
  const ids = story.cluster_posts_results.slice(0, 5).map((p: { post_id: string }) => p.post_id).join(",");
  const posts = await xGet(
    "/2/tweets",
    { ids, "tweet.fields": "public_metrics,entities,referenced_tweets", expansions: "author_id", "user.fields": "username" },
    "app",
    "06_cluster_posts",
  );
  const users = new Map((posts.body.includes?.users ?? []).map((u: any) => [u.id, u.username]));
  console.log(`\ncluster posts of ${story.id}:`);
  for (const p of posts.body.data ?? []) {
    const links = (p.entities?.urls ?? []).map((u: any) => u.unwound_url ?? u.expanded_url).join(" ");
    console.log(`  @${users.get(p.author_id)} likes=${p.public_metrics.like_count} links: ${links || "none"}`);
  }
}
