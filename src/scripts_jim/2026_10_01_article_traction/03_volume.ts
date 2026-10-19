/**
 * Experiment 3: how many posts would a crowd scan return per day, and so what it
 * would cost at $0.005 per post read. Uses the counts endpoint, which costs
 * $0.005 per request no matter how many posts match, on one of Nathan's lists.
 * Prints only aggregate numbers.
 */
import { xGet } from "./x";

const LIST_ID = "1813915107736408080";
const QUERIES = {
  allLinks: `list:${LIST_ID} has:links -is:retweet`,
  linksMin20Likes: `list:${LIST_ID} has:links -is:retweet min_likes:20`,
  quotes: `list:${LIST_ID} is:quote`,
  retweets: `list:${LIST_ID} is:retweet`,
};

for (const [label, query] of Object.entries(QUERIES)) {
  const result = await xGet("/2/tweets/counts/recent", { query, granularity: "day" }, "app", `03_counts_${label}`);
  const days = result.body.data ?? [];
  const total = result.body.meta?.total_tweet_count ?? 0;
  console.log(`${label}: status ${result.status}, ${total} posts over ${days.length} days, ${(total / Math.max(days.length, 1)).toFixed(0)} per day`);
}
