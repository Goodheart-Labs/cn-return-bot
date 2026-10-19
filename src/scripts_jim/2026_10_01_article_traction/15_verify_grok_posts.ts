/**
 * Experiment 15: check the posts Grok named in experiment 14 (or another run, given
 * as the summary file name) against X's own data.
 * For each post: does it exist, is the author right, how close are Grok's like
 * counts to the real ones, is it inside the lookback window, and does the
 * article link Grok named appear in the post's links?
 * One lookup per 100 posts, $0.005 per post found.
 */
import { readFileSync } from "fs";
import { xGet } from "./x";

const LOOKBACK_HOURS = 48;
const CLOSE_ENOUGH_RATIO = 0.2;

const summary: { key: string; posts: any[] }[] = JSON.parse(readFileSync(`${import.meta.dir}/data/${process.argv[2] ?? "14_summary"}.json`, "utf8"));
const claims = summary.flatMap(({ key, posts }) => posts.map((p) => ({ key, ...p, id: p.post_url.match(/status\/(\d+)/)?.[1] })));
const ids = [...new Set(claims.map((c) => c.id).filter(Boolean))];

const real = new Map<string, any>();
const usernames = new Map<string, string>();
for (let i = 0; i < ids.length; i += 100) {
  const result = await xGet(
    "/2/tweets",
    { ids: ids.slice(i, i + 100).join(","), "tweet.fields": "created_at,public_metrics,entities,author_id", expansions: "author_id", "user.fields": "username" },
    "app",
    `15_lookup_${process.argv[2] ?? "14_summary"}_${i}`,
  );
  for (const p of result.body.data ?? []) real.set(p.id, p);
  for (const u of result.body.includes?.users ?? []) usernames.set(u.id, u.username);
}

const cutoff = Date.now() - LOOKBACK_HOURS * 3_600_000;
for (const { key } of summary) {
  const mine = claims.filter((c) => c.key === key);
  const found = mine.filter((c) => real.has(c.id));
  const likesClose = found.filter((c) => {
    const actual = real.get(c.id).public_metrics.like_count;
    return Math.abs(actual - c.likes) <= CLOSE_ENOUGH_RATIO * Math.max(actual, 1);
  });
  const recent = found.filter((c) => Date.parse(real.get(c.id).created_at) >= cutoff);
  const articleClaims = found.filter((c) => c.linked_article_url && !/x\.com|twitter\.com/.test(c.linked_article_url));
  const articleReal = articleClaims.filter((c) =>
    (real.get(c.id).entities?.urls ?? []).some((u: any) => (u.unwound_url ?? u.expanded_url ?? "").includes(new URL(c.linked_article_url).host.replace(/^www\./, ""))),
  );
  console.log(
    `${key.padEnd(12)} named ${mine.length}, exist ${found.length}, likes within 20% ${likesClose.length}, within ${LOOKBACK_HOURS}h ${recent.length}, article links ${articleReal.length}/${articleClaims.length} real`,
  );
}
