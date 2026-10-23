/**
 * Asks Grok which X posts about an article, blog post, video or podcast went
 * viral in Nathan Young's crowd, so the minisite finder knows what is making
 * the rounds. It prints the posts and posts nothing anywhere.
 *
 * Grok searches X once per topic with its x_search tool, by default limited to
 * posts from yesterday and today. The topics run in parallel.
 *
 *   bun run trending-on-x                          # every topic of the crowd
 *   bun run trending-on-x --topic "AI safety" --topic "UK politics"
 *   bun run trending-on-x --days 4                 # posts from the last 4 days instead of 2
 *   bun run trending-on-x --ask "<question>"       # one free question to Grok with X search, answer printed as is
 *   bun run trending-on-x --json
 *
 * The investigation behind the prompt and the date handling is in
 * src/scripts_jim/2026_10_01_article_traction/ (GOO-289).
 */

import { xaiNativeGenerate } from "../pipeline/llm/xai";

const MODEL = "grok-4.3";
const MAX_POSTS_PER_TOPIC = 8;
const DEFAULT_DAYS = 2;
const DAY_MS = 86_400_000;
const TOPICS = [
  "AI safety",
  "AI",
  "effective altruism",
  "forecasting",
  "rationalist",
  "tpot",
  "progress studies",
  "economics",
  "US politics",
  "UK politics",
];

type TrendingPost = { post_url: string; author: string; likes: number; article_url: string; article_author: string; summary: string };

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
          article_author: { type: "string", description: "who wrote or made the article, video or podcast" },
          summary: { type: "string", description: "one sentence on what the post says about the article" },
        },
        required: ["post_url", "author", "likes", "article_url", "article_author", "summary"],
      },
    },
  },
  required: ["posts"],
};

function buildPrompt(topic: string): string {
  return `Find recent posts on X that went viral among Nathan Young's (@NathanpmYoung) crowd, specifically the ${topic} community, and that reference or are about an article, blog post, video or podcast.
List at most ${MAX_POSTS_PER_TOPIC} posts, most liked first. Only list posts that clearly went viral in this community. Fewer posts, or none, is fine.`;
}

/** xAI's docs call to_date inclusive, but a search with from_date equal to
 *  to_date finds no posts at all, and with to_date set to the next day every
 *  post returned is from the first day (experiment 19 of the investigation).
 *  So to_date behaves as the start of that day, and searching through today
 *  needs tomorrow as to_date. */
function searchDays(days: number) {
  const now = Date.now();
  const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { fromDate: date(now - (days - 1) * DAY_MS), toDate: date(now + DAY_MS) };
}

async function findTrendingPosts(topic: string, days: number): Promise<TrendingPost[]> {
  const result = await xaiNativeGenerate({
    model: MODEL,
    userMessage: buildPrompt(topic),
    enableXSearch: true,
    xSearchDays: searchDays(days),
    responseSchema: RESPONSE_SCHEMA,
  });
  if (!result.parsed) throw new Error(`Grok returned no parseable JSON for ${topic}: ${result.text.slice(0, 300)}`);
  console.error(`${topic}: ${result.parsed.posts.length} posts, ${result.searchCalls} searches, $${result.cost.cost.toFixed(3)}`);
  return result.parsed.posts;
}

async function ask(question: string, days: number) {
  const result = await xaiNativeGenerate({ model: MODEL, userMessage: question, enableXSearch: true, xSearchDays: searchDays(days) });
  console.error(`${result.searchCalls} searches, $${result.cost.cost.toFixed(3)}`);
  console.log(result.text);
}

function formatTopic(topic: string, posts: TrendingPost[]): string {
  const lines = posts.map(
    (p) => `- @${p.author}, ${p.likes.toLocaleString("en-US")} likes, ${p.post_url}\n  ${p.summary}\n  Article by ${p.article_author}: ${p.article_url}`,
  );
  return [`## ${topic}`, ...(lines.length > 0 ? lines : ["(nothing)"])].join("\n");
}

function readFlags(name: string): string[] {
  return process.argv.flatMap((arg, i) => {
    const value = process.argv[i + 1];
    return arg === name && value ? [value] : [];
  });
}

const days = Number(readFlags("--days")[0] ?? DEFAULT_DAYS);
const question = readFlags("--ask")[0];
if (question) {
  await ask(question, days);
  process.exit(0);
}

const topics = readFlags("--topic").length > 0 ? readFlags("--topic") : TOPICS;
// A topic whose Grok call failed is printed as an error instead of failing the
// whole run, because the other topics' posts are still worth reading.
type TopicOutcome = { topic: string } & ({ type: "posts"; posts: TrendingPost[] } | { type: "error"; error: string });
const outcomes = await Promise.all(
  topics.map(async (topic): Promise<TopicOutcome> => {
    try {
      return { topic, type: "posts", posts: await findTrendingPosts(topic, days) };
    } catch (err) {
      return { topic, type: "error", error: err instanceof Error ? err.message : String(err) };
    }
  }),
);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(outcomes, null, 2));
} else {
  console.log(outcomes.map((o) => (o.type === "posts" ? formatTopic(o.topic, o.posts) : `## ${o.topic}\nERROR: ${o.error}`)).join("\n\n"));
}
