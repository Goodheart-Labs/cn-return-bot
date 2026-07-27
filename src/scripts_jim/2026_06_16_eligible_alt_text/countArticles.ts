/**
 * Count how many eligible posts are Articles (carry an `article` object).
 * Paginates to build the largest sample the endpoint will give. Read-only.
 */

import "dotenv/config";
import axios from "axios";
import { getOAuth1Headers } from "../../api/getOAuthToken";

const API_URL = "https://api.x.com/2/notes/search/posts_eligible_for_notes";
const MAX_PAGES = 20;

function baseParams(token?: string): URLSearchParams {
  const p = new URLSearchParams({
    "tweet.fields": "article,note_tweet,text,author_id",
    expansions: "article.cover_media,article.media_entities,author_id",
    "user.fields": "username",
    max_results: "100",
    test_mode: "true",
  });
  if (token) p.append("pagination_token", token);
  return p;
}

async function call(token?: string) {
  const url = `${API_URL}?${baseParams(token).toString().replace(/\+/g, "%20")}`;
  const resp = await axios.get(url, {
    headers: { ...getOAuth1Headers(url, "GET"), "Content-Type": "application/json" },
    timeout: 30_000,
  });
  return resp.data;
}

async function main() {
  const seen = new Set<string>();
  const userById = new Map<string, any>();
  const articles: any[] = [];
  let token: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const data = await call(token);
    pages++;
    for (const u of data.includes?.users ?? []) userById.set(u.id, u);
    let newOnPage = 0;
    for (const t of data.data ?? []) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      newOnPage++;
      if (t.article) articles.push(t);
    }
    token = data.meta?.next_token;
    if (!token || newOnPage === 0) break;
  }

  console.log(`sampled ${seen.size} unique posts across ${pages} page(s)`);
  console.log(`articles: ${articles.length} (${((articles.length / seen.size) * 100).toFixed(1)}%)\n`);

  for (const t of articles.slice(0, 10)) {
    const username = userById.get(t.author_id)?.username;
    const link = username ? `https://x.com/${username}/status/${t.id}` : `https://x.com/i/web/status/${t.id}`;
    console.log(link);
    console.log(`  article keys: ${Object.keys(t.article)}`);
    console.log(`  title: ${JSON.stringify(t.article.title)}`);
    console.log("");
  }
}

main().catch((err: any) => {
  console.error(`FAILED status=${err.response?.status} ${err.response?.statusText ?? err.message}`);
  if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
  process.exit(1);
});
