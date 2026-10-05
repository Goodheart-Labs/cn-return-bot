/**
 * Experiment 2: which recent-search operators work on our pay-per-use app, and
 * what the link fields look like.
 * - Nathan's own lists and the lists he is a member of, as candidate crowd lists.
 * - `list:<id>` restricts a search to a list's members.
 * - `min_likes:` filters by engagement on the server, so we pay only for posts that pass.
 * - `from:a OR from:b` is the fallback when no list exists.
 */
import { xGet } from "./x";

const NATHAN_ID = "1160994871";
const POST_FIELDS = "created_at,author_id,public_metrics,entities,referenced_tweets,article,note_tweet";

const owned = await xGet(`/2/users/${NATHAN_ID}/owned_lists`, { "list.fields": "member_count,description,private", max_results: 100 }, "app", "02_owned_lists");
console.log("owned lists", owned.status);
for (const l of owned.body.data ?? []) console.log("  -", l.id, l.name, l.member_count);

async function search(label: string, query: string, maxResults = 10) {
  const result = await xGet(
    "/2/tweets/search/recent",
    { query, max_results: maxResults, "tweet.fields": POST_FIELDS, expansions: "author_id", "user.fields": "username" },
    "app",
    `02_search_${label}`,
  );
  const users = new Map((result.body.includes?.users ?? []).map((u: any) => [u.id, u.username]));
  console.log(`\nsearch ${label} [${query}] -> ${result.status}, ${result.body.meta?.result_count ?? 0} posts`);
  for (const p of result.body.data ?? []) {
    const urls = (p.entities?.urls ?? []).map((u: any) => `${u.unwound_url ?? u.expanded_url} ${u.title ? `"${u.title}"` : ""}`);
    console.log(`  @${users.get(p.author_id)} likes=${p.public_metrics.like_count} rt=${p.public_metrics.retweet_count} q=${p.public_metrics.quote_count} ${urls.join(" ; ")}`);
  }
  return result;
}

await search("min_likes", '"effective altruism" has:links -is:retweet min_likes:50');
await search("from_or", "(from:NathanpmYoung OR from:ESYudkowsky OR from:robbensinger OR from:So8res OR from:ohabryka) has:links -is:retweet");
const firstList = owned.body.data?.[0];
if (firstList) await search("list", `list:${firstList.id} has:links -is:retweet min_likes:20`);
