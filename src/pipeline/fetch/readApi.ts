/**
 * Every request the page reader sends to a site's API goes through readApi:
 * a forum's GraphQL query, Substack's post endpoint, a Substack RSS feed. The
 * fetcher sends one plain request, and when a bot check answers, it opens the
 * address in its headless Chromium, which the check lets through
 * (fetchApi.ts). When a bot check stops the browser too, Jina Reader fetches
 * the address with its own browsers. Jina runs here and not in the fetcher,
 * because it needs a key.
 */

import { askFetcher } from "../../service/client";
import { FETCH_API_PATH, type ApiAnswer } from "../../service/contract";
import { fetchApi } from "./fetchApi";
import { fetchApiWithJina, JINA_FALLBACK } from "./jinaReader";

export type ApiRead = { type: "answer"; body: string; etag?: string } | { type: "not_modified" } | { type: "unreadable"; reason: string };

export type JsonRead = { type: "json"; json: unknown } | { type: "unreadable"; reason: string };

/** `etag` is the version tag of the last answer. A site whose answer has not
 *  changed since then answers that it was not modified. */
export async function readApi(address: string, options: { etag?: string } = {}): Promise<ApiRead> {
  const { etag } = options;
  const fetched = await askFetcher<ApiAnswer>(FETCH_API_PATH, { url: address, ...(etag && { etag }) }, () => fetchApi(address, etag));
  if (fetched.type !== "bot_check" || !JINA_FALLBACK) return toApiRead(fetched);
  const read = toApiRead(await fetchApiWithJina(address));
  // Our own browser gets through the bot checks we know, and Jina costs
  // money, so the run log says when Jina had to be asked.
  const outcome = read.type === "unreadable" ? `failed too (${read.reason})` : "got an answer";
  console.log(`[read-api] a bot check stopped the fetcher's request and its browser at ${new URL(address).origin}, and Jina Reader ${outcome}`);
  return read;
}

export async function readJsonApi(address: string): Promise<JsonRead> {
  const read = await readApi(address);
  if (read.type === "unreadable") return read;
  if (read.type === "not_modified") return { type: "unreadable", reason: "a request without an ETag got 304 Not Modified" };
  try {
    return { type: "json", json: JSON.parse(read.body) };
  } catch {
    return { type: "unreadable", reason: "the answer is not JSON" };
  }
}

function toApiRead(answer: ApiAnswer): ApiRead {
  if (answer.type === "answer" || answer.type === "not_modified") return answer;
  return { type: "unreadable", reason: answer.type === "bot_check" ? "a bot check stopped every request" : answer.reason };
}
