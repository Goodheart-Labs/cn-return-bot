/**
 * Dump the entire eligible-posts feed to disk, trying the largest feed size
 * the account is admitted for (xxl -> xl -> large -> small).
 *
 * Paginates through every page the API returns, dedupes by post id, and writes:
 *   - feed_dump.jsonl  : one JSON object per post (id, author, text, quoted text, metrics)
 *   - feed_dump.md     : human-readable document of tweet text + quoted tweet text
 *   - feed_dump.summary.json : { feedSize, pages, posts, fetchedAt }
 *
 * Read-only. On GitHub Actions the X_* secrets are the admitted production note
 * writer (xl/xxl access). Locally pass `--local` to route to LOCAL_X_* (small only).
 * Env overrides: FEED_SIZE (skip the fallback chain), OUT_DIR, MAX_PAGES, TEST_MODE.
 */
import axios from "axios";
import fs from "fs";
import path from "path";
import { getOAuth1Headers } from "../../api/getOAuthToken";
import { parsePostsResponse, type Post } from "../../api/fetchEligiblePosts";

if (process.argv.includes("--local")) {
  // The admitted prod writer lives only in GH Actions secrets. Locally the only
  // account that reads the real feed is LOCAL_X_*, and only at feed_size=small.
  process.env.X_API_KEY = process.env.LOCAL_X_API_KEY;
  process.env.X_API_KEY_SECRET = process.env.LOCAL_X_API_KEY_SECRET;
  process.env.X_ACCESS_TOKEN = process.env.LOCAL_X_ACCESS_TOKEN;
  process.env.X_ACCESS_TOKEN_SECRET = process.env.LOCAL_X_ACCESS_TOKEN_SECRET;
}

const TEST_MODE = process.env.TEST_MODE ?? "false"; // real live feed, not the sandbox
const FEED_SIZE_CHAIN = process.env.FEED_SIZE ? [process.env.FEED_SIZE] : ["xxl", "xl", "large", "small"];

const API_URL = "https://api.x.com/2/notes/search/posts_eligible_for_notes";
const BASE_FIELDS = {
  "tweet.fields": "created_at,author_id,referenced_tweets,public_metrics,attachments",
  "media.fields": "type,url,preview_image_url,height,width,duration_ms,public_metrics,variants",
  "user.fields": "public_metrics,name,description",
  expansions: "attachments.media_keys,referenced_tweets.id,referenced_tweets.id.attachments.media_keys,author_id",
  test_mode: TEST_MODE,
};
const MAX_RESULTS_PER_PAGE = 100;
const HARD_PAGE_CAP = process.env.MAX_PAGES ? Number(process.env.MAX_PAGES) : 1000;

const OUT_DIR = process.env.OUT_DIR ?? import.meta.dir;
const JSONL_PATH = path.join(OUT_DIR, "feed_dump.jsonl");
const MD_PATH = path.join(OUT_DIR, "feed_dump.md");
const SUMMARY_PATH = path.join(OUT_DIR, "feed_dump.summary.json");

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

async function resolveFeedSize(): Promise<string> {
  for (const size of FEED_SIZE_CHAIN) {
    try {
      const res = await fetchPage(size);
      const n = res.data?.data?.length ?? 0;
      console.log(`[feed] ${size} feed responded with ${n} posts on page 1`);
      return size;
    } catch (err: any) {
      const status = err?.response?.status;
      const body = JSON.stringify(err?.response?.data ?? err?.message);
      console.warn(`[feed] ${size} feed failed (status ${status}): ${body}`);
    }
  }
  throw new Error(`No accessible feed size in chain: ${FEED_SIZE_CHAIN.join(", ")}`);
}

function postToRecord(post: Post) {
  return {
    id: post.id,
    created_at: post.created_at,
    author_name: post.author_name,
    author_description: post.author_description,
    author_followers: post.author_followers,
    text: post.text,
    quoted_text: post.referenced_tweet_data?.text ?? null,
    quoted_author_id: post.referenced_tweet_data?.author_id ?? null,
    has_media: (post.media?.length ?? 0) > 0,
    impressions: post.public_metrics?.impression_count ?? null,
    likes: post.public_metrics?.like_count ?? null,
  };
}

function appendMd(post: Post, index: number) {
  const m = post.public_metrics;
  const lines = [
    `## [${index}] ${post.id}`,
    `author: ${post.author_name ?? "?"} | followers: ${post.author_followers ?? "?"} | impressions: ${m?.impression_count ?? "?"} | created: ${post.created_at ?? "?"}`,
    "",
    "TWEET:",
    post.text ?? "",
  ];
  if (post.referenced_tweet_data?.text) {
    lines.push("", "QUOTED/RT:", post.referenced_tweet_data.text);
  }
  lines.push("", "---", "");
  fs.appendFileSync(MD_PATH, lines.join("\n") + "\n");
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(JSONL_PATH, "");
  fs.writeFileSync(MD_PATH, `# Eligible-posts feed dump\n\nFetched ${new Date().toISOString()}\n\n`);

  const feedSize = await resolveFeedSize();
  console.log(`[feed] Using feed_size=${feedSize}`);

  const seen = new Set<string>();
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
      console.warn(`[feed] page ${page} failed (status ${status}): ${JSON.stringify(err?.response?.data ?? err?.message)}`);
      // brief backoff then retry once on this token
      await new Promise((r) => setTimeout(r, 5000));
      try {
        res = await fetchPage(feedSize, nextToken);
      } catch (err2: any) {
        console.error(`[feed] page ${page} retry failed; stopping pagination.`);
        break;
      }
    }

    const posts = parsePostsResponse(res.data);
    let newCount = 0;
    for (const post of posts) {
      if (seen.has(post.id)) continue;
      seen.add(post.id);
      newCount++;
      fs.appendFileSync(JSONL_PATH, JSON.stringify(postToRecord(post)) + "\n");
      appendMd(post, seen.size);
    }

    nextToken = res.data?.meta?.next_token;
    console.log(`[feed] page ${page}: ${posts.length} posts (${newCount} new), total=${seen.size}, nextToken=${nextToken ? "yes" : "no"}`);

    if (posts.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 2) {
        console.log("[feed] two consecutive empty pages; stopping.");
        break;
      }
    } else {
      consecutiveEmpty = 0;
    }

    if (!nextToken) {
      console.log("[feed] no next_token; reached end of feed.");
      break;
    }
  }

  fs.writeFileSync(
    SUMMARY_PATH,
    JSON.stringify({ feedSize, testMode: TEST_MODE, pages: page, posts: seen.size, fetchedAt: new Date().toISOString() }, null, 2)
  );

  console.log(`\n[feed] DONE. feed_size=${feedSize}, pages=${page}, unique posts=${seen.size}`);
  console.log(`[feed] jsonl:   ${JSONL_PATH}`);
  console.log(`[feed] md:      ${MD_PATH}`);
  console.log(`[feed] summary: ${SUMMARY_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
