/* Step 3: Nathan's posts on X that link to Common Notes, from X's full-archive
 * search, and replies to them from the accounts they tag. Grok's x_search was
 * rate limited (HTTP 429) twice on 2026-11-05, so this asks X directly with
 * Jim's pay-per-use app. A post costs $0.005. Writes x_posts.json.
 *   bun run src/scripts_jim/2026_11_05_nathan_posted_notes/03_search_x.ts */
import { writeFile } from "node:fs/promises";
import { xGet } from "../2026_10_01_article_traction/x";

const OUT = new URL("./x_posts.json", import.meta.url).pathname;
const START_TIME = "2026-08-01T00:00:00Z";
const POST_FIELDS = "created_at,author_id,public_metrics,entities,referenced_tweets,conversation_id,in_reply_to_user_id,note_tweet";
const MAX_RESULTS = 100;
/* Full-archive search allows one request per second. A 429 answer means we
 * went too fast, so we wait and ask again, a little longer each time. */
const SECONDS_BETWEEN_REQUESTS = 1.2;
const RATE_LIMIT_WAITS_SECONDS = [5, 15, 30, 60, 120];
const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

async function searchPage(params: Record<string, string | number>, label: string) {
  for (const wait of [...RATE_LIMIT_WAITS_SECONDS, null]) {
    await sleep(SECONDS_BETWEEN_REQUESTS);
    const result = await xGet("/2/tweets/search/all", params, "app", label);
    if (result.status === 200) return result;
    if (result.status !== 429 || wait === null) throw new Error(`search failed with ${result.status}`);
    await sleep(wait);
  }
  throw new Error("unreachable");
}

async function searchAll(query: string, label: string) {
  const posts: any[] = [];
  const users = new Map<string, string>();
  let nextToken: string | undefined;
  do {
    const params: Record<string, string | number> = {
      query, start_time: START_TIME, max_results: MAX_RESULTS, "tweet.fields": POST_FIELDS,
      expansions: "author_id,entities.mentions.username", "user.fields": "username",
    };
    if (nextToken) params.next_token = nextToken;
    const result = await searchPage(params, label);
    posts.push(...(result.body.data ?? []));
    for (const user of result.body.includes?.users ?? []) users.set(user.id, user.username);
    nextToken = result.body.meta?.next_token;
  } while (nextToken);
  return { posts, users };
}

/* Posts made through the posting tool are long posts. Their link to the note
 * sits in the long text, which the url: operator does not search, so they are
 * found by the posting tool's fixed wording instead. */
const QUERIES = [
  "from:NathanpmYoung (url:commonnotes.net OR commonnotes)",
  'from:NathanpmYoung ("Link to note" OR "Additional context" OR "found this helpful" OR "Claim, from")',
];
const byId = new Map<string, any>();
for (const [index, query] of QUERIES.entries()) {
  for (const post of (await searchAll(query, `nathan_${index}`)).posts) byId.set(post.id, post);
}
const nathanPosts = { posts: [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)) };
console.log(`${nathanPosts.posts.length} posts by Nathan`);
const results = [];
for (const post of nathanPosts.posts) {
  const entities = post.note_tweet?.entities ?? post.entities ?? {};
  const mentioned: string[] = [...new Set<string>((entities.mentions ?? []).map((m: any) => m.username))];
  let replies: any[] = [];
  if (mentioned.length > 0) {
    const fromTagged = mentioned.map((handle) => `from:${handle}`).join(" OR ");
    replies = (await searchAll(`conversation_id:${post.conversation_id} (${fromTagged})`, `replies_${post.id}`)).posts;
  }
  results.push({
    url: `https://x.com/NathanpmYoung/status/${post.id}`,
    created_at: post.created_at,
    text: post.note_tweet?.text ?? post.text,
    links: (entities.urls ?? []).map((u: any) => u.unwound_url ?? u.expanded_url),
    mentioned,
    metrics: post.public_metrics,
    tagged_replies: replies.map((r) => ({ url: `https://x.com/i/status/${r.id}`, text: r.note_tweet?.text ?? r.text, created_at: r.created_at })),
  });
}
await writeFile(OUT, JSON.stringify(results, null, 1));
for (const r of results) console.log(`${r.created_at.slice(0, 10)} ${r.url} tags=${r.mentioned.join(",")} replies=${r.tagged_replies.length}\n   links: ${r.links.join(" ")}`);
