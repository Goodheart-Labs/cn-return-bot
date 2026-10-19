/**
 * Experiment 1: cheap probes of what each X endpoint returns.
 * - Nathan's profile, to learn how many accounts he follows.
 * - News search for a crowd topic.
 * - Worldwide trends and Jim's personalized trends.
 */
import { xGet } from "./x";

const nathan = await xGet("/2/users/by/username/NathanpmYoung", { "user.fields": "public_metrics" }, "app", "01_nathan_profile");
console.log("app", JSON.stringify(nathan.body.data));


for (const query of ["AI safety", "effective altruism", "prediction markets"]) {
  const news = await xGet(
    "/2/news/search",
    { query, max_results: 5, max_age_hours: 72, "news.fields": "name,summary,category,contexts,keywords,cluster_posts_results,updated_at" },
    "app",
    `01_news_${query.replace(/\s/g, "_")}`,
  );
  console.log(`news "${query}"`, news.status);
  for (const story of news.body.data ?? []) console.log("  -", story.name, `(${story.cluster_posts_results?.length ?? 0} posts)`);
}

const trends = await xGet("/2/trends/by/woeid/1", { "trend.fields": "trend_name,tweet_count" }, "app", "01_trends_world");
console.log("world trends", trends.status, (trends.body.data ?? []).slice(0, 10).map((t: any) => t.trend_name).join(" | "));

const personal = await xGet(
  "/2/users/personalized_trends",
  { "personalized_trend.fields": "trend_name,post_count,category,trending_since" },
  "user",
  "01_trends_personal",
);
console.log("personal trends", personal.status);
for (const t of personal.body.data ?? []) console.log("  -", t.trend_name, t.category, t.post_count);
