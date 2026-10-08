/**
 * Experiment 9: backtest the "distinct crowd sharers per article" signal on the
 * last 24 hours of @JimMaar1's 72 follows.
 *
 * Every post that can point at an article is read once: original posts with a
 * link, quotes and reposts. Each post is mapped to the articles it points at,
 * either through its own links or through the post it quotes or reposts. Then we
 * count, per article, how many distinct crowd accounts pointed at it.
 * Costs about $0.005 per post read, so roughly $1.35 for one day of this crowd.
 */
import { readFileSync, writeFileSync } from "fs";
import { xGet } from "./x";

const LOOKBACK_HOURS = 24;
const MAX_QUERY_LENGTH = 512;
const PAGE_SIZE = 100;
const SUFFIX = "(has:links OR is:quote OR is:retweet) -is:reply";

const handles: string[] = JSON.parse(readFileSync(`${import.meta.dir}/data/04_following_jim.json`, "utf8")).data.map((u: any) => u.username);

function batchQueries(): string[] {
  const batches: string[] = [];
  let current: string[] = [];
  const build = (names: string[]) => `(${names.map((h) => `from:${h}`).join(" OR ")}) ${SUFFIX}`;
  for (const handle of handles) {
    if (build([...current, handle]).length > MAX_QUERY_LENGTH) {
      batches.push(build(current));
      current = [];
    }
    current.push(handle);
  }
  if (current.length) batches.push(build(current));
  return batches;
}

/** Links that are not articles: other posts, media attachments, profiles. */
const NON_ARTICLE = /^https?:\/\/(x|twitter)\.com\/(?!i\/article\/)/;

function canonicalUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_") || key === "s" || key === "ref") url.searchParams.delete(key);
  return `${url.host.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}${url.search}`;
}

function articleUrls(post: any): string[] {
  return (post?.entities?.urls ?? [])
    .map((u: any) => u.unwound_url ?? u.expanded_url)
    .filter((u: string | undefined) => u && !NON_ARTICLE.test(u))
    .map(canonicalUrl);
}

const startTime = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();
const posts: any[] = [];
const referenced = new Map<string, any>();
const usernames = new Map<string, string>();
let calls = 0;

for (const query of batchQueries()) {
  let nextToken: string | undefined;
  do {
    const result = await xGet(
      "/2/tweets/search/recent",
      {
        query,
        start_time: startTime,
        max_results: PAGE_SIZE,
        "tweet.fields": "author_id,entities,referenced_tweets,public_metrics,created_at",
        expansions: "author_id,referenced_tweets.id",
        "user.fields": "username",
        ...(nextToken ? { next_token: nextToken } : {}),
      },
      "app",
    );
    calls++;
    posts.push(...(result.body.data ?? []));
    for (const t of result.body.includes?.tweets ?? []) referenced.set(t.id, t);
    for (const u of result.body.includes?.users ?? []) usernames.set(u.id, u.username);
    nextToken = result.body.meta?.next_token;
  } while (nextToken);
}
writeFileSync(`${import.meta.dir}/data/09_posts.json`, JSON.stringify({ posts, referenced: [...referenced.values()] }));

const sharers = new Map<string, Set<string>>();
for (const post of posts) {
  const pointedAt = (post.referenced_tweets ?? [])
    .filter((r: any) => r.type === "quoted" || r.type === "retweeted")
    .map((r: any) => referenced.get(r.id));
  const urls = new Set([...articleUrls(post), ...pointedAt.flatMap(articleUrls)]);
  for (const url of urls) {
    if (!sharers.has(url)) sharers.set(url, new Set());
    sharers.get(url)!.add(post.author_id);
  }
}

const ranked = [...sharers.entries()].sort((a, b) => b[1].size - a[1].size);
console.log(`${calls} calls, ${posts.length} crowd posts and ${referenced.size} referenced posts read, ${sharers.size} distinct articles`);
const histogram = new Map<number, number>();
for (const [, s] of ranked) histogram.set(s.size, (histogram.get(s.size) ?? 0) + 1);
console.log("articles by number of distinct crowd sharers:", JSON.stringify(Object.fromEntries(histogram)));
for (const [url, s] of ranked.slice(0, 12)) console.log(`  ${s.size}  ${url.slice(0, 110)}`);
