/**
 * Experiment 4: estimate the daily post volume of a crowd given as an account's follows.
 * On 2026-10-01 it read a sample of 200 of Nathan's follows ($0.01 each) and then
 * ran out of X credits. On 2026-10-02 it reads all 72 follows of @JimMaar1, whose
 * "Today's News" panel already shows crowd stories. Then it asks the
 * counts endpoint ($0.005 per request) how many posts of each kind those accounts
 * made in the last 7 days. A search query may be at most 512 characters, so the
 * handles go in batches joined by OR. Prints only aggregate numbers.
 */
import { xGet } from "./x";

const JIM_ID = "1791543825489334272";
const SAMPLE_SIZE = 1000;
const MAX_QUERY_LENGTH = 512;


const following = await xGet(`/2/users/${JIM_ID}/following`, { max_results: SAMPLE_SIZE, "user.fields": "public_metrics" }, "app", "04_following_jim");
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
  const perAccount = perDay / handles.length;
  console.log(`${label}: ${queries.length} queries, ${perDay.toFixed(0)}/day, ${perAccount.toFixed(2)} per account per day, $${(perDay * 0.005).toFixed(2)}/day to read`);
}
