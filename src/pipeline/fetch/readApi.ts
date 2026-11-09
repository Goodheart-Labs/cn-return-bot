/**
 * Every request the page reader sends to a site's API goes through readApi:
 * a forum's GraphQL query, Substack's post endpoint, a Substack RSS feed. It
 * takes the same steps as the page ladder. First one plain request from the
 * fetcher. When a bot check answers, headless Chromium in the fetcher opens
 * the site's front page, which runs the bot check's script, and makes the
 * request from inside that page. When a bot check still answers, Jina Reader
 * fetches the address with its own browsers. Jina runs here and not in the
 * fetcher, because it needs a key.
 */

import { askFetcher } from "../../service/client";
import { FETCH_API_IN_BROWSER_PATH, FETCH_API_PATH, type ApiAnswer } from "../../service/contract";
import { fetchApiInBrowser, fetchApiPlain } from "./fetchApi";
import { fetchApiWithJina, JINA_FALLBACK } from "./jinaReader";

type ApiStep = "the headless browser" | "Jina Reader";

export type ApiRead = { type: "answer"; body: string } | { type: "unreadable"; reason: string };

export type JsonRead = { type: "json"; json: unknown } | { type: "unreadable"; reason: string };

export async function readApi(address: string): Promise<ApiRead> {
  const plain = await askFetcher<ApiAnswer>(FETCH_API_PATH, { url: address }, () => fetchApiPlain(address));
  if (plain.type !== "bot_check") return toApiRead(plain);
  const inBrowser = await askFetcher<ApiAnswer>(FETCH_API_IN_BROWSER_PATH, { url: address }, () => fetchApiInBrowser(address));
  if (inBrowser.type !== "bot_check") return logStep(toApiRead(inBrowser), address, "the headless browser");
  if (!JINA_FALLBACK) return toApiRead(inBrowser);
  return logStep(toApiRead(await fetchApiWithJina(address)), address, "Jina Reader");
}

export async function readJsonApi(address: string): Promise<JsonRead> {
  const read = await readApi(address);
  if (read.type === "unreadable") return read;
  try {
    return { type: "json", json: JSON.parse(read.body) };
  } catch {
    return { type: "unreadable", reason: "the answer is not JSON" };
  }
}

function toApiRead(answer: ApiAnswer): ApiRead {
  if (answer.type === "answer") return answer;
  return { type: "unreadable", reason: answer.type === "bot_check" ? "a bot check stopped every request" : answer.reason };
}

/** A bot check in front of an API is rare, so the run log says which step got
 *  past it. */
function logStep(read: ApiRead, address: string, step: ApiStep): ApiRead {
  const outcome = read.type === "answer" ? "got an answer" : `failed too (${read.reason})`;
  console.log(`[read-api] a bot check stopped the plain request to ${new URL(address).origin}, and ${step} ${outcome}`);
  return read;
}
