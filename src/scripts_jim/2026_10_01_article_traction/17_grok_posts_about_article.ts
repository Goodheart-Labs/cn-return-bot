/**
 * Experiment 17: can Grok find the posts that discuss one particular article?
 * Three articles the crowd shared on 2026-10-01 (seen in experiment 9). Each runs
 * on grok-4.3, and the Economist piece also on grok-4.7.
 * The LessWrong post, which grok-4.3 could not find, also runs on grok-4.7.
 * Every post Grok names is then looked up on X ($0.005 each) to check that it exists and whether it links
 * the article itself.
 */
import { grokXSearch } from "./grok";
import { xGet } from "./x";

const LOOKBACK_DAYS = 3;
const ARTICLES = {
  economist: "https://www.economist.com/leaders/2026/10/01/effective-altruism-is-this-centurys-biggest-idea",
  lesswrong: "https://www.lesswrong.com/posts/vzKWsEskYBEWTwpBP/what-s-the-date",
  normaltech: "https://www.normaltech.ai/p/a-big-tent-or-small-tent-ai-safety",
};
/** Pass "rerun" to run only the last entry, so earlier runs are not paid for twice. */
const ALL_RUNS: { article: keyof typeof ARTICLES; model: string }[] = [
  { article: "economist", model: "grok-4.3" },
  { article: "lesswrong", model: "grok-4.3" },
  { article: "normaltech", model: "grok-4.3" },
  { article: "economist", model: "grok-4.7" },
  { article: "lesswrong", model: "grok-4.7" },
];
const RUNS = process.argv[2] === "rerun" ? ALL_RUNS.slice(-1) : ALL_RUNS;

const prompt = (url: string) => `Find posts on X from the last ${LOOKBACK_DAYS} days that link to or discuss this article: ${url}
Return JSON only: {"posts":[{"post_url":string,"author":string,"likes":number,"links_article":boolean,"stance":string}]}, at most 10 posts, most engaged first.`;

/** The article's path without host or query, which is how it shows up inside a post's expanded links. */
const articlePath = (url: string) => new URL(url).pathname.replace(/\/$/, "");

const runs = await Promise.all(
  RUNS.map(async (r) => ({ ...r, ...(await grokXSearch(`17_${r.article}_${r.model}`, prompt(ARTICLES[r.article]), LOOKBACK_DAYS, r.model)) })),
);

const ids = [...new Set(runs.flatMap((r) => r.parsed.posts.map((p: any) => p.post_url.match(/status\/(\d+)/)?.[1]).filter(Boolean)))];
const lookup = await xGet(
  "/2/tweets",
  { ids: ids.join(","), "tweet.fields": "public_metrics,entities,referenced_tweets", expansions: "referenced_tweets.id", "user.fields": "username" },
  "app",
  "17_lookup",
);
const real = new Map((lookup.body.data ?? []).map((p: any) => [p.id, p]));
const referenced = new Map((lookup.body.includes?.tweets ?? []).map((p: any) => [p.id, p]));
const linksTo = (post: any, path: string) => (post?.entities?.urls ?? []).some((u: any) => (u.unwound_url ?? u.expanded_url ?? "").includes(path));

for (const { article, model, parsed, costUsd, searchCalls } of runs) {
  const path = articlePath(ARTICLES[article]);
  const posts = parsed.posts.map((p: any) => real.get(p.post_url.match(/status\/(\d+)/)?.[1]));
  const exist = posts.filter(Boolean);
  const direct = exist.filter((p: any) => linksTo(p, path));
  const viaQuote = exist.filter((p: any) => !linksTo(p, path) && (p.referenced_tweets ?? []).some((r: any) => linksTo(referenced.get(r.id), path)));
  const likes = exist.map((p: any) => p.public_metrics.like_count).sort((a: number, b: number) => b - a);
  console.log(
    `${article.padEnd(10)} ${model}: $${costUsd.toFixed(3)}, ${searchCalls} tool calls, named ${parsed.posts.length}, exist ${exist.length}, link it ${direct.length}, quote a post that links it ${viaQuote.length}, likes ${likes.join(",")}`,
  );
}
