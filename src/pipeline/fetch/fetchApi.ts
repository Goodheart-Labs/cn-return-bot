/**
 * Requests to a site's API, such as a forum's GraphQL endpoint or Substack's
 * post endpoint. On the services machine only the sandboxed fetcher runs
 * these, like the fetch ladder. readApi in readApi.ts asks the fetcher for
 * them, and runs them in its own process where there is no fetcher.
 *
 * A request is sent plainly first. When a bot check answers it, the headless
 * browser opens the same address, waits for the check to let it through, and
 * reads the answer as the browser shows it (botCheck.ts).
 */

import type { BrowserContext, Cookie } from "playwright";
import type { ApiAnswer } from "../../service/contract";
import { getBrowser } from "../utils/browserManager";
import { isWebUrl } from "../utils/webUrl";
import { isBotCheck, isBotCheckPage, openPastBotCheck } from "./botCheck";
import { FETCH_UAS } from "./fetchLadder";

const API_TIMEOUT_MS = 15_000;

/** JSON first, because some APIs answer a request that prefers HTML with a
 *  page for people instead. LessWrong's GraphQL endpoint shows its landing
 *  page then. */
const API_ACCEPT = "application/json, */*;q=0.8";

const NOT_MODIFIED = 304;
const FIRST_ERROR_STATUS = 400;

/** The cookies each site gave our browser, by the site's origin. Among them
 *  is the pass of the site's bot check. A browser that comes back with the
 *  pass is not checked again while it lasts, which is an hour at Vercel. So
 *  the browser passes the EA Forum's check once an hour, not on each of the
 *  walk's three requests a minute. A site is in this map from the moment its
 *  bot check let the browser through, and such a site is asked through the
 *  browser at once, because its bot check stops every plain request. */
const sitePasses = new Map<string, Cookie[]>();

/** `etag` is the version tag of the last answer. Only the plain request sends
 *  it, and a site whose answer has not changed then answers 304 with no body.
 *  So a site behind a bot check answers in full each time. */
export async function fetchApi(address: string, etag?: string): Promise<ApiAnswer> {
  if (!isWebUrl(address)) return { type: "failed", reason: "only http and https addresses are fetched" };
  const { origin } = new URL(address);
  if (!sitePasses.has(origin)) {
    const plain = await fetchApiPlain(address, etag);
    if (plain.type !== "bot_check") return plain;
  }
  return fetchApiInBrowser(address, origin);
}

async function fetchApiPlain(address: string, etag?: string): Promise<ApiAnswer> {
  try {
    const response = await fetch(address, {
      headers: { "User-Agent": FETCH_UAS.desktop, Accept: API_ACCEPT, ...(etag && { "If-None-Match": etag }) },
      redirect: "follow",
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (isBotCheck((name) => response.headers.get(name))) return { type: "bot_check" };
    if (response.status === NOT_MODIFIED) return { type: "not_modified" };
    if (!response.ok) return { type: "failed", reason: `HTTP ${response.status}` };
    return { type: "answer", body: await response.text(), ...(response.headers.get("etag") && { etag: response.headers.get("etag")! }) };
  } catch (err: any) {
    return { type: "failed", reason: err?.message?.slice(0, 200) ?? "network error" };
  }
}

/** Opens the address in headless Chromium, as a person would open it in a
 *  tab, and returns what the site served once its bot check had passed. The
 *  browser context starts with the site's cookies from the last request and
 *  is closed afterwards, so nothing else carries over. */
async function fetchApiInBrowser(address: string, origin: string): Promise<ApiAnswer> {
  let context: BrowserContext | null = null;
  try {
    context = await (await getBrowser()).newContext({
      userAgent: FETCH_UAS.desktop,
      locale: "en-US",
      storageState: { cookies: sitePasses.get(origin) ?? [], origins: [] },
    });
    const served = await openPastBotCheck(await context.newPage(), address);
    if (isBotCheckPage(served)) {
      sitePasses.delete(origin);
      return { type: "bot_check" };
    }
    sitePasses.set(origin, await context.cookies());
    if (served.status() >= FIRST_ERROR_STATUS) return { type: "failed", reason: `HTTP ${served.status()} in the browser` };
    return { type: "answer", body: await served.text() };
  } catch (err: any) {
    return { type: "failed", reason: err?.message?.slice(0, 200) ?? "browser error" };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}
