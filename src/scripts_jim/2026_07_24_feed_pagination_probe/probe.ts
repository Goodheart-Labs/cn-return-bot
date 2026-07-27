/**
 * Probe: page through one eligible-posts feed to the end and log exactly what
 * the API returns per page — data length, the raw `meta` object, and the
 * rate-limit headers — so we can see what "the last page" actually looks like
 * (missing next_token? empty page WITH a token? an error?) and design
 * fetchEligiblePosts' stop condition around reality instead of guesses.
 *
 * Read-only (GET). Run from the repo root:
 *   bun --env-file=<path-to-.env> run src/scripts_jim/2026_07_24_feed_pagination_probe/probe.ts
 * Env: FEED_SIZE (default small), MAX_PAGES (default 30).
 */

import axios, { AxiosError } from "axios";
import { getOAuth1Headers } from "../../api/getOAuthToken";
import { POST_API_FIELD_PARAMS } from "../../api/fetchEligiblePosts";
import { buildPostSelection, type FeedSize } from "../../pipeline/orchestration/utils/feedSizeStrategy";

const FEED_SIZE = (process.env.FEED_SIZE as FeedSize) ?? "small";
const MAX_PAGES = process.env.MAX_PAGES ? Number(process.env.MAX_PAGES) : 30;
// The local .env's X_* account is not admitted for test_mode=false; TEST_MODE=true
// lets the probe run on it (pagination mechanics should be identical).
const TEST_MODE = process.env.TEST_MODE === "true" ? "true" : "false";
const PAGE_SIZE = 100;
const API_URL = "https://api.x.com/2/notes/search/posts_eligible_for_notes";

const RATE_HEADERS = [
  "x-rate-limit-limit",
  "x-rate-limit-remaining",
  "x-rate-limit-reset",
  "x-app-limit-24hour-limit",
  "x-app-limit-24hour-remaining",
  "x-user-limit-24hour-limit",
  "x-user-limit-24hour-remaining",
];

function pickRateHeaders(headers: Record<string, unknown>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of RATE_HEADERS) {
    if (headers[name] != null) picked[name] = String(headers[name]);
  }
  return picked;
}

async function fetchPage(paginationToken?: string) {
  const params = new URLSearchParams({
    ...POST_API_FIELD_PARAMS,
    test_mode: TEST_MODE,
    max_results: String(PAGE_SIZE),
    post_selection: buildPostSelection(FEED_SIZE),
  });
  if (paginationToken) params.append("pagination_token", paginationToken);
  const fullUrl = `${API_URL}?${params.toString().replace(/\+/g, "%20")}`;
  return axios.get(fullUrl, {
    headers: { ...getOAuth1Headers(fullUrl, "GET"), "Content-Type": "application/json" },
    timeout: 30_000,
  });
}

async function main() {
  console.log(`[probe] feed=${FEED_SIZE} page_size=${PAGE_SIZE} max_pages=${MAX_PAGES} test_mode=${TEST_MODE}`);
  let nextToken: string | undefined;
  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const res = await fetchPage(nextToken);
      const data: unknown[] = res.data.data ?? [];
      console.log(
        `[probe] page ${page}: status=${res.status} data=${data.length} ` +
          `meta=${JSON.stringify(res.data.meta ?? null)} ` +
          `errors=${res.data.errors ? JSON.stringify(res.data.errors).slice(0, 300) : "none"} ` +
          `rate=${JSON.stringify(pickRateHeaders(res.headers as Record<string, unknown>))}`
      );
      nextToken = res.data.meta?.next_token;
      if (!nextToken) {
        console.log(`[probe] page ${page} had no next_token — feed exhausted cleanly`);
        return;
      }
    } catch (err) {
      const axiosErr = err as AxiosError;
      console.log(
        `[probe] page ${page}: ERROR status=${axiosErr.response?.status ?? "none"} ` +
          `body=${JSON.stringify(axiosErr.response?.data ?? null)} ` +
          `rate=${JSON.stringify(pickRateHeaders((axiosErr.response?.headers ?? {}) as Record<string, unknown>))} ` +
          `message=${axiosErr.message}`
      );
      return;
    }
  }
  console.log(`[probe] stopped at MAX_PAGES=${MAX_PAGES} with a next_token still present`);
}

main();
