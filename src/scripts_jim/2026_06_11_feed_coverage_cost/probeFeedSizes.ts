/**
 * Read-only: paginate the `small` and `large` eligible-posts feeds to exhaustion
 * with the admitted prod writer (X_*), recording created_at + impressions per post.
 * Writes one JSON summary per feed so we can size each feed and estimate daily inflow.
 *
 * Read-only — only GETs the feed. No account-modifying calls.
 */
import axios from "axios";
import fs from "fs";
import path from "path";
import { getOAuth1Headers } from "../../api/getOAuthToken";
import { parsePostsResponse } from "../../api/fetchEligiblePosts";

if (process.argv.includes("--local")) {
  process.env.X_API_KEY = process.env.LOCAL_X_API_KEY;
  process.env.X_API_KEY_SECRET = process.env.LOCAL_X_API_KEY_SECRET;
  process.env.X_ACCESS_TOKEN = process.env.LOCAL_X_ACCESS_TOKEN;
  process.env.X_ACCESS_TOKEN_SECRET = process.env.LOCAL_X_ACCESS_TOKEN_SECRET;
}

const FEEDS = process.env.FEEDS ? process.env.FEEDS.split(",") : ["small", "large"];

const API_URL = "https://api.x.com/2/notes/search/posts_eligible_for_notes";
const BASE_FIELDS = {
  "tweet.fields": "created_at,author_id,public_metrics",
  "user.fields": "public_metrics",
  expansions: "author_id",
  test_mode: "false",
};
const MAX_RESULTS_PER_PAGE = 100;
const HARD_PAGE_CAP = 800;
const OUT_DIR = import.meta.dir;

async function fetchPage(feedSize: string, paginationToken?: string) {
  const params = new URLSearchParams({
    ...BASE_FIELDS,
    max_results: String(MAX_RESULTS_PER_PAGE),
    post_selection: `feed_size: ${feedSize}, feed_lang: en`,
  });
  if (paginationToken) params.append("pagination_token", paginationToken);
  const fullUrl = `${API_URL}?${params.toString().replace(/\+/g, "%20")}`;
  return axios.get(fullUrl, {
    headers: { ...getOAuth1Headers(fullUrl, "GET"), "Content-Type": "application/json" },
    timeout: 30_000,
  });
}

async function probeFeed(feedSize: string) {
  const seen = new Set<string>();
  const records: { created_at: string | undefined; impressions: number | null }[] = [];
  let nextToken: string | undefined;
  let page = 0;
  let consecutiveEmpty = 0;

  while (page < HARD_PAGE_CAP) {
    page++;
    let res;
    try {
      res = await fetchPage(feedSize, nextToken);
    } catch (err: any) {
      const status = err?.response?.status;
      console.warn(`[${feedSize}] page ${page} failed (${status}): ${JSON.stringify(err?.response?.data ?? err?.message)}`);
      await new Promise((r) => setTimeout(r, 5000));
      try {
        res = await fetchPage(feedSize, nextToken);
      } catch {
        console.error(`[${feedSize}] page ${page} retry failed; stopping.`);
        break;
      }
    }
    const posts = parsePostsResponse(res.data);
    let newCount = 0;
    for (const post of posts) {
      if (seen.has(post.id)) continue;
      seen.add(post.id);
      newCount++;
      records.push({
        created_at: post.created_at,
        impressions: post.public_metrics?.impression_count ?? null,
      });
    }
    nextToken = res.data?.meta?.next_token;
    if (page % 20 === 0 || !nextToken) {
      console.log(`[${feedSize}] page ${page}: total=${seen.size}, nextToken=${nextToken ? "yes" : "no"}`);
    }
    if (posts.length === 0) {
      if (++consecutiveEmpty >= 2) break;
    } else consecutiveEmpty = 0;
    if (!nextToken) break;
  }

  const out = {
    feedSize,
    pages: page,
    posts: seen.size,
    fetchedAt: new Date().toISOString(),
    records,
  };
  const file = path.join(OUT_DIR, `feed_${feedSize}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`[${feedSize}] DONE pages=${page} posts=${seen.size} -> ${file}\n`);
}

async function main() {
  for (const size of FEEDS) {
    await probeFeed(size);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
