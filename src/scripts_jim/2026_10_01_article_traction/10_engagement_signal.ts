/**
 * Experiment 10: re-rank the articles from experiment 9 by the engagement of the
 * most engaged post that links each one. This needs no new API calls, because
 * every post we read, and every post it quotes or reposts, came with its
 * public_metrics. Prints the article address, the number of distinct crowd
 * sharers, and the likes, reposts and quotes of the strongest linking post.
 */
import { readFileSync } from "fs";

const { posts, referenced } = JSON.parse(readFileSync(`${import.meta.dir}/data/09_posts.json`, "utf8"));
const NON_ARTICLE = /^https?:\/\/(x|twitter)\.com\/(?!i\/article\/)/;

function canonicalUrl(raw: string): string {
  const url = new URL(raw);
  return `${url.host.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
}
const articleUrls = (post: any): string[] =>
  (post?.entities?.urls ?? []).map((u: any) => u.unwound_url ?? u.expanded_url).filter((u: string) => u && !NON_ARTICLE.test(u)).map(canonicalUrl);

const engagement = (post: any) => post.public_metrics.like_count + 3 * post.public_metrics.retweet_count + 3 * post.public_metrics.quote_count;
const articles = new Map<string, { sharers: Set<string>; best: any }>();
for (const post of [...posts, ...referenced]) {
  for (const url of articleUrls(post)) {
    const entry = articles.get(url) ?? { sharers: new Set(), best: post };
    if (engagement(post) > engagement(entry.best)) entry.best = post;
    articles.set(url, entry);
  }
}
for (const post of posts) {
  const pointedAt = (post.referenced_tweets ?? []).map((r: any) => referenced.find((t: any) => t.id === r.id));
  for (const url of new Set([...articleUrls(post), ...pointedAt.flatMap(articleUrls)])) articles.get(url)?.sharers.add(post.author_id);
}

const ranked = [...articles.entries()].sort((a, b) => engagement(b[1].best) - engagement(a[1].best));
for (const [url, { sharers, best }] of ranked.slice(0, 15)) {
  const m = best.public_metrics;
  console.log(`${String(engagement(best)).padStart(6)}  sharers=${sharers.size} likes=${m.like_count} rt=${m.retweet_count} q=${m.quote_count}  ${url.slice(0, 90)}`);
}
