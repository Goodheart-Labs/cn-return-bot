/**
 * Experiment 4: estimate the daily post volume of Nathan's follows.
 * Reads a sample of 200 of the accounts he follows ($0.01 each), then asks the
 * counts endpoint ($0.005 per request) how many posts of each kind those accounts
 * made in the last 7 days. A search query may be at most 512 characters, so the
 * handles go in batches joined by OR. Prints only aggregate numbers.
 */
import { xGet } from "./x";

const NATHAN_ID = "1160994871";
const SAMPLE_SIZE = 200;
const MAX_QUERY_LENGTH = 512;
const FOLLOW_COUNT = 3893;

const following = await xGet(`/2/users/${NATHAN_ID}/following`, { max_results: SAMPLE_SIZE, "user.fields": "public_metrics" }, "app", "04_following_sample");
const handles: string[] = (following.body.data ?? []).map((u: any) => u.username);
console.log(`sampled ${handles.length} follows`);

function batchQueries(suffix: string): string[] {
  const batches: string[] = [];
  let current: string[] = [];
  const build = (names: string[]) => `(${names.map((h) => `from:${h}`).join(" OR ")}) ${suffix}`;
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

const KINDS = {
  originalLinkPosts: "has:links -is:retweet -is:reply -is:quote",
  quotes: "is:quote",
  retweetsOfLinks: "is:retweet has:links",
  allRetweets: "is:retweet",
  everything: "",
};

for (const [label, suffix] of Object.entries(KINDS)) {
  let total = 0;
  const queries = batchQueries(suffix);
  for (const [i, query] of queries.entries()) {
    const result = await xGet("/2/tweets/counts/recent", { query, granularity: "day" }, "app", `04_counts_${label}_${i}`);
    total += result.body.meta?.total_tweet_count ?? 0;
  }
  const perDay = total / 7;
  const scaled = (perDay * FOLLOW_COUNT) / handles.length;
  console.log(`${label}: ${queries.length} queries, ${perDay.toFixed(0)}/day in sample, about ${scaled.toFixed(0)}/day for all follows, about $${(scaled * 0.005).toFixed(2)}/day to read`);
}
