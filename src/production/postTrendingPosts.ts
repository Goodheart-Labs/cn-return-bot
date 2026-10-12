/**
 * Posts to Slack the X posts about an article or blog post that recently went
 * viral in Nathan Young's crowd.
 *
 * Once a day, Grok searches X once per topic of the crowd with its x_search tool,
 * limited to posts from yesterday and today. Each topic with new posts becomes
 * one Slack message. The table trending_posts remembers every post already
 * posted, so a post that comes back on the next run is not posted again.
 *
 * The investigation behind this design is in
 * src/scripts_jim/2026_10_01_article_traction/ (GOO-289).
 *
 *   bun run trending-posts            # post to the channel in SLACK_TRENDING_POSTS_CHANNEL_ID
 *   bun run trending-posts --dry-run  # print the messages instead of posting them
 */

import { getSupabaseClient } from "../api/supabaseClient";
import { xaiNativeGenerate } from "../pipeline/llm/xai";
import { postSlackMessage } from "../utils/slack";

const MODEL = "grok-4.3";
const MAX_POSTS_PER_TOPIC = 5;
const DAY_MS = 86_400_000;
const TOPICS = [
  "AI safety",
  "effective altruism",
  "forecasting",
  "rationalist",
  "tpot",
  "progress studies",
  "US politics",
  "UK politics",
];

type TrendingPost = { post_url: string; author: string; likes: number; article_url: string; summary: string };

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          post_url: { type: "string" },
          author: { type: "string", description: "the X handle, without @" },
          likes: { type: "number" },
          article_url: { type: "string" },
          summary: { type: "string", description: "one sentence on what the post says about the article" },
        },
        required: ["post_url", "author", "likes", "article_url", "summary"],
      },
    },
  },
  required: ["posts"],
};

function buildPrompt(topic: string): string {
  return `Find recent posts on X that went viral among Nathan Young's (@NathanpmYoung) crowd, specifically the ${topic} community, and that reference or are about an article or blog post.
List at most ${MAX_POSTS_PER_TOPIC} posts, most liked first. Only list posts that clearly went viral in this community. Fewer posts, or none, is fine.`;
}

/** The search covers yesterday and today. xAI's docs call to_date inclusive,
 *  but a search with from_date equal to to_date finds no posts at all, and with
 *  to_date set to the next day every post returned is from the first day
 *  (experiment 19 of the investigation). So to_date behaves as the start of
 *  that day, and searching through today needs tomorrow as to_date. */
function searchDays(now: number) {
  const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { fromDate: date(now - DAY_MS), toDate: date(now + DAY_MS) };
}

function postId(post: TrendingPost): string {
  const id = post.post_url.match(/status\/(\d+)/)?.[1];
  if (!id) throw new Error(`Grok returned a post address without a post id: ${post.post_url}`);
  return id;
}

async function findTrendingPosts(topic: string, now: number): Promise<TrendingPost[]> {
  const result = await xaiNativeGenerate({
    model: MODEL,
    userMessage: buildPrompt(topic),
    enableXSearch: true,
    xSearchDays: searchDays(now),
    responseSchema: RESPONSE_SCHEMA,
  });
  if (!result.parsed) throw new Error(`Grok returned no parseable JSON for ${topic}: ${result.text.slice(0, 300)}`);
  const posts: TrendingPost[] = result.parsed.posts;
  // A post address without an id fails this topic here, inside its own error
  // handling, instead of failing the whole run later.
  posts.forEach(postId);
  console.log(`${topic}: ${posts.length} posts, ${result.searchCalls} searches, $${result.cost.cost.toFixed(3)}`);
  return posts;
}

/** At most 5 posts per topic come back, so this list stays far below the size
 *  where an .in() filter or the 1,000-row cap would matter. */
async function fetchAlreadyPosted(ids: string[]): Promise<Set<string>> {
  const { data, error } = await getSupabaseClient().from("trending_posts").select("post_id").in("post_id", ids);
  if (error) throw new Error(`Reading trending_posts failed: ${error.message}`);
  return new Set(data.map((row) => row.post_id));
}

async function recordPosted(topic: string, posts: TrendingPost[]) {
  const rows = posts.map((p) => ({ post_id: postId(p), topic }));
  const { error } = await getSupabaseClient().from("trending_posts").insert(rows);
  if (error) throw new Error(`Recording posted posts in trending_posts failed: ${error.message}`);
}

function formatMessage(topic: string, posts: TrendingPost[]): string {
  const lines = posts.map(
    (p) => `- [@${p.author}](${p.post_url}), ${p.likes.toLocaleString("en-US")} likes. ${p.summary} [Article](${p.article_url})`,
  );
  return [`**Trending in ${topic}**`, "", ...lines].join("\n");
}

const dryRun = process.argv.includes("--dry-run");
const channel = process.env.SLACK_TRENDING_POSTS_CHANNEL_ID;
if (!dryRun && !channel) throw new Error("Missing required environment variable: SLACK_TRENDING_POSTS_CHANNEL_ID");

const now = Date.now();
// A topic whose Grok call failed is recorded instead of thrown, so the topics
// that worked are still posted. The run fails at the end, after posting them.
type TopicOutcome = { topic: string } & ({ type: "posts"; posts: TrendingPost[] } | { type: "error"; error: string });
const outcomes = await Promise.all(
  TOPICS.map(async (topic): Promise<TopicOutcome> => {
    try {
      return { topic, type: "posts", posts: await findTrendingPosts(topic, now) };
    } catch (err) {
      return { topic, type: "error", error: err instanceof Error ? err.message : String(err) };
    }
  }),
);

// A post can come back under two topics in one run, so posts are also marked
// as seen within the run.
const found = outcomes.flatMap((o) => (o.type === "posts" ? o.posts : []));
const seen = await fetchAlreadyPosted(found.map(postId));
for (const outcome of outcomes) {
  if (outcome.type === "error") continue;
  const fresh = outcome.posts.filter((p) => !seen.has(postId(p)));
  fresh.forEach((p) => seen.add(postId(p)));
  console.log(`${outcome.topic}: ${fresh.length} of ${outcome.posts.length} posts not posted before`);
  if (fresh.length === 0) continue;
  const markdown = formatMessage(outcome.topic, fresh);
  if (dryRun) {
    console.log(`\n${markdown}`);
    continue;
  }
  await postSlackMessage({ channel: channel!, markdown });
  await recordPosted(outcome.topic, fresh);
}
const failures = outcomes.flatMap((o) => (o.type === "error" ? [`${o.topic}: ${o.error}`] : []));
if (failures.length > 0) throw new Error(`Grok search failed for ${failures.length} topics:\n${failures.join("\n")}`);
