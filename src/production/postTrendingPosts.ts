/**
 * Posts to Slack the X posts about an article or blog post that went viral in
 * Nathan Young's crowd yesterday.
 *
 * Once a day, Grok searches X once per topic of the crowd with its x_search tool.
 * Each topic that has results becomes one Slack message. The search covers
 * exactly the previous UTC day, so a post can never be listed on two days, and we
 * need no record of what was posted before.
 *
 * The investigation behind this design is in
 * src/scripts_jim/2026_10_01_article_traction/ (GOO-289).
 *
 *   bun run trending-posts            # post to the channel in SLACK_TRENDING_POSTS_CHANNEL_ID
 *   bun run trending-posts --dry-run  # print the messages instead of posting them
 */

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

function buildPrompt(topic: string, day: string): string {
  return `Find posts on X from ${day} that went viral among Nathan Young's (@NathanpmYoung) crowd, specifically the ${topic} community, and that reference or are about an article or blog post.
List at most ${MAX_POSTS_PER_TOPIC} posts, most liked first. Only list posts that clearly went viral in this community. Fewer posts, or none, is fine.`;
}

/** xAI's docs call to_date inclusive, but a search with from_date equal to
 *  to_date finds no posts at all. With to_date set to the next day, every post
 *  it returns is from the first day (tested 2026-10-02 in experiment 19 of the
 *  investigation). So to_date behaves as the start of that day, and one day of
 *  posts needs the next day as to_date. */
function nextDay(day: string): string {
  return new Date(Date.parse(day) + DAY_MS).toISOString().slice(0, 10);
}

async function findTrendingPosts(topic: string, day: string): Promise<TrendingPost[]> {
  const result = await xaiNativeGenerate({
    model: MODEL,
    userMessage: buildPrompt(topic, day),
    enableXSearch: true,
    xSearchDays: { fromDate: day, toDate: nextDay(day) },
    responseSchema: RESPONSE_SCHEMA,
  });
  if (!result.parsed) throw new Error(`Grok returned no parseable JSON for ${topic}: ${result.text.slice(0, 300)}`);
  console.log(`${topic}: ${result.parsed.posts.length} posts from ${day}, ${result.searchCalls} searches, $${result.cost.cost.toFixed(3)}`);
  return result.parsed.posts;
}

function formatMessage(topic: string, day: string, posts: TrendingPost[]): string {
  const lines = posts.map(
    (p) => `- [@${p.author}](${p.post_url}), ${p.likes.toLocaleString("en-US")} likes. ${p.summary} [Article](${p.article_url})`,
  );
  return [`**Trending in ${topic}** (posts from ${day})`, "", ...lines].join("\n");
}

const dryRun = process.argv.includes("--dry-run");
const channel = process.env.SLACK_TRENDING_POSTS_CHANNEL_ID;
if (!dryRun && !channel) throw new Error("Missing required environment variable: SLACK_TRENDING_POSTS_CHANNEL_ID");

const yesterday = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
// A topic whose Grok call failed is recorded instead of thrown, so the topics
// that worked are still posted. The run fails at the end, after posting them.
type TopicOutcome = { topic: string } & ({ type: "posts"; posts: TrendingPost[] } | { type: "error"; error: string });
const outcomes = await Promise.all(
  TOPICS.map(async (topic): Promise<TopicOutcome> => {
    try {
      return { topic, type: "posts", posts: await findTrendingPosts(topic, yesterday) };
    } catch (err) {
      return { topic, type: "error", error: err instanceof Error ? err.message : String(err) };
    }
  }),
);

for (const outcome of outcomes) {
  if (outcome.type === "error" || outcome.posts.length === 0) continue;
  const markdown = formatMessage(outcome.topic, yesterday, outcome.posts);
  if (dryRun) console.log(`\n${markdown}`);
  else await postSlackMessage({ channel: channel!, markdown });
}
const failures = outcomes.flatMap((o) => (o.type === "error" ? [`${o.topic}: ${o.error}`] : []));
if (failures.length > 0) throw new Error(`Grok search failed for ${failures.length} topics:\n${failures.join("\n")}`);
