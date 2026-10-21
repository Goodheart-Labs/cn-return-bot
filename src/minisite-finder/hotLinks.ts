/**
 * Prints the most upvoted links of the last few days on Hacker News and the top
 * posts on LessWrong, so the minisite finder sees what technical and
 * rationalist readers are discussing. Grok's X search (trendingOnX.ts) covers X.
 *
 *   bun run hot-links            # the last 3 days
 *   bun run hot-links --days 7
 *
 * Hacker News is read through Algolia's public search API, and LessWrong
 * through its public GraphQL API. The EA Forum blocks datacenter addresses, so
 * it is missing here.
 */

const DEFAULT_DAYS = 3;
const DAY_MS = 86_400_000;
const HN_MIN_POINTS = 150;
const HN_LIMIT = 40;
const LESSWRONG_LIMIT = 25;

type HnHit = { title: string; url: string | null; points: number; num_comments: number; objectID: string };
type LessWrongPost = { title: string; pageUrl: string; baseScore: number; commentCount: number; postedAt: string; user: { displayName: string } | null };

async function fetchHackerNews(sinceSeconds: number): Promise<HnHit[]> {
  const params = new URLSearchParams({
    tags: "story",
    numericFilters: `created_at_i>${sinceSeconds},points>${HN_MIN_POINTS}`,
    hitsPerPage: "200",
  });
  const res = await fetch(`https://hn.algolia.com/api/v1/search_by_date?${params}`);
  if (!res.ok) throw new Error(`Hacker News search answered ${res.status}`);
  const { hits } = (await res.json()) as { hits: HnHit[] };
  return hits.sort((a, b) => b.points - a.points).slice(0, HN_LIMIT);
}

async function fetchLessWrongTop(sinceIso: string): Promise<LessWrongPost[]> {
  const query = `{ posts(input: { terms: { view: "top", after: "${sinceIso}", limit: ${LESSWRONG_LIMIT} } }) {
    results { title pageUrl baseScore commentCount postedAt user { displayName } } } }`;
  const res = await fetch("https://www.lesswrong.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "common-notes-minisite-finder" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`LessWrong answered ${res.status}`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(`LessWrong GraphQL error: ${body.errors[0].message}`);
  return body.data.posts.results;
}

const daysIndex = process.argv.indexOf("--days");
const days = daysIndex === -1 ? DEFAULT_DAYS : Number(process.argv[daysIndex + 1]);
const since = Date.now() - days * DAY_MS;
const [hackerNews, lessWrong] = await Promise.all([fetchHackerNews(Math.floor(since / 1000)), fetchLessWrongTop(new Date(since).toISOString())]);

console.log(`## Hacker News, last ${days} days, at least ${HN_MIN_POINTS} points`);
for (const hit of hackerNews) {
  console.log(`- ${hit.points} pts, ${hit.num_comments} comments: ${hit.title}\n  ${hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`}`);
}
console.log(`\n## LessWrong top posts, last ${days} days`);
for (const post of lessWrong) {
  console.log(`- ${post.baseScore} karma, ${post.commentCount} comments, ${post.postedAt.slice(0, 10)}: ${post.title} (${post.user?.displayName ?? "?"})\n  ${post.pageUrl}`);
}
