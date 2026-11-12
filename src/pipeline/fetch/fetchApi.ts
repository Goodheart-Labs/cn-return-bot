/**
 * Requests to a site's API, such as a forum's GraphQL endpoint or Substack's
 * post endpoint. On the services machine only the sandboxed fetcher runs
 * these, like the fetch ladder. readApi in readApi.ts asks the fetcher for
 * them, and runs them in its own process where there is no fetcher.
 */

import type { ApiAnswer } from "../../service/contract";
import { getBrowser } from "../utils/browserManager";
import { isWebUrl } from "../utils/webUrl";
import { FETCH_UAS } from "./fetchLadder";

const API_TIMEOUT_MS = 15_000;

/** How long the headless browser may take to open the site's front page. */
const FRONT_PAGE_TIMEOUT_MS = 20_000;

/** How long the browser keeps asking while the site's bot check is still
 *  running its script, and how long it waits between two tries. Vercel's
 *  checkpoint passed within a few seconds on the devbox (GOO-745). */
const BOT_CHECK_PATIENCE_MS = 20_000;
const BOT_CHECK_RETRY_MS = 2_000;

/** JSON first, because some APIs answer a request that prefers HTML with a
 *  page for people instead. LessWrong's GraphQL endpoint shows its landing
 *  page then. */
const API_ACCEPT = "application/json, */*;q=0.8";

const REFUSED_NON_WEB_URL = "only http and https addresses are fetched";

/** The headers by which a site says it answered with a bot check: Vercel's
 *  Security Checkpoint and Cloudflare's challenge page. Both answer with a
 *  page that runs a script in the browser before the site lets it through. */
const BOT_CHECK_HEADERS = ["x-vercel-mitigated", "cf-mitigated"];
const BOT_CHECK_VALUE = "challenge";

const isBotCheck = (headers: { get(name: string): string | null }) =>
  BOT_CHECK_HEADERS.some((name) => headers.get(name) === BOT_CHECK_VALUE);

/** One plain request. */
export async function fetchApiPlain(address: string): Promise<ApiAnswer> {
  if (!isWebUrl(address)) return { type: "failed", reason: REFUSED_NON_WEB_URL };
  try {
    const response = await fetch(address, {
      headers: { "User-Agent": FETCH_UAS.desktop, Accept: API_ACCEPT },
      redirect: "follow",
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (isBotCheck(response.headers)) return { type: "bot_check" };
    if (!response.ok) return { type: "failed", reason: `HTTP ${response.status}` };
    return { type: "answer", body: await response.text() };
  } catch (err: any) {
    return { type: "failed", reason: err?.message?.slice(0, 200) ?? "network error" };
  }
}

/** What one request made from inside the page found. */
type InPageAnswer = { type: "answer"; status: number; botCheck: boolean; body: string } | { type: "lost"; reason: string };

/** The same request, made by headless Chromium from inside the site's own
 *  front page. Opening the front page runs the bot check's script, which is
 *  what a site behind Vercel's or Cloudflare's check wants to see, and a
 *  request from that page then carries what the check gave the browser. Each
 *  call gets its own browser context, so nothing carries over to the next. */
export async function fetchApiInBrowser(address: string): Promise<ApiAnswer> {
  if (!isWebUrl(address)) return { type: "failed", reason: REFUSED_NON_WEB_URL };
  let context: import("playwright").BrowserContext | null = null;
  try {
    context = await (await getBrowser()).newContext({ userAgent: FETCH_UAS.desktop, locale: "en-US" });
    const page = await context.newPage();
    await page.goto(new URL(address).origin, { waitUntil: "domcontentloaded", timeout: FRONT_PAGE_TIMEOUT_MS });
    const deadline = Date.now() + BOT_CHECK_PATIENCE_MS;
    while (true) {
      const answer = await requestFromPage(page, address);
      if (answer.type === "answer" && !answer.botCheck) {
        return answer.status < 400 ? { type: "answer", body: answer.body } : { type: "failed", reason: `HTTP ${answer.status} in the browser` };
      }
      if (Date.now() > deadline) return answer.type === "lost" ? { type: "failed", reason: answer.reason } : { type: "bot_check" };
      await page.waitForTimeout(BOT_CHECK_RETRY_MS);
    }
  } catch (err: any) {
    return { type: "failed", reason: err?.message?.slice(0, 200) ?? "browser error" };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

/** Makes the request from inside the page. The bot check reloads the page
 *  once its script has passed, and a request running during that reload is
 *  lost. The caller then simply tries again. */
async function requestFromPage(page: import("playwright").Page, address: string): Promise<InPageAnswer> {
  try {
    return await page.evaluate(
      async ({ address, accept, headerNames, botCheckValue }) => {
        const response = await fetch(address, { headers: { Accept: accept } });
        const botCheck = headerNames.some((name) => response.headers.get(name) === botCheckValue);
        return { type: "answer" as const, status: response.status, botCheck, body: await response.text() };
      },
      { address, accept: API_ACCEPT, headerNames: BOT_CHECK_HEADERS, botCheckValue: BOT_CHECK_VALUE },
    );
  } catch (err: any) {
    return { type: "lost", reason: err?.message?.slice(0, 200) ?? "the request inside the page failed" };
  }
}
