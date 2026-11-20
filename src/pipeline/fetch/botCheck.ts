/**
 * A bot check is the page a site answers with, instead of what was asked for,
 * when it suspects a program: Vercel's Security Checkpoint, which stands in
 * front of the EA Forum, and Cloudflare's challenge page. That page runs a
 * script in the browser. When the script finds a real browser, the site gives
 * the browser a cookie as its pass and reloads the page, which now shows what
 * was asked for.
 *
 * Our headless Chromium gets through Vercel's check since it no longer tells
 * pages that a program drives it (HIDE_AUTOMATION_FLAG in browserManager.ts).
 * Until then the check's script refused it, and only Jina Reader could read
 * the EA Forum (GOO-832).
 */

import type { Page, Response } from "playwright";

/** The headers by which a site says that its answer is a bot check. */
const BOT_CHECK_HEADERS = ["x-vercel-mitigated", "cf-mitigated"];
const BOT_CHECK_VALUE = "challenge";

/** How long the browser waits for the page behind a bot check. From the
 *  services machine, Vercel's check let the browser through within 2 seconds
 *  (GOO-832). */
const BOT_CHECK_PATIENCE_MS = 20_000;

const FIRST_REDIRECT_STATUS = 300;
const FIRST_ERROR_STATUS = 400;

/** `header` looks one header of an answer up by its lower-case name. */
export function isBotCheck(header: (name: string) => string | null | undefined): boolean {
  return BOT_CHECK_HEADERS.some((name) => header(name) === BOT_CHECK_VALUE);
}

export const isBotCheckPage = (document: Response) => isBotCheck((name) => document.headers()[name]);

/** Opens an address in a browser page and returns the document the site
 *  served for it. When a bot check answers first, this waits for the document
 *  that follows once the check has let the browser through. When the check
 *  never does, it returns the check's own page, which isBotCheckPage tells
 *  apart. */
export async function openPastBotCheck(page: Page, address: string): Promise<Response> {
  const documents: Response[] = [];
  const isBehindTheCheck = (response: Response) => {
    const isRedirect = response.status() >= FIRST_REDIRECT_STATUS && response.status() < FIRST_ERROR_STATUS;
    if (isRedirect || !response.request().isNavigationRequest() || response.frame() !== page.mainFrame()) return false;
    documents.push(response);
    return !isBotCheckPage(response);
  };
  try {
    const [served] = await Promise.all([
      page.waitForResponse(isBehindTheCheck, { timeout: BOT_CHECK_PATIENCE_MS }),
      page.goto(address, { waitUntil: "commit", timeout: BOT_CHECK_PATIENCE_MS }),
    ]);
    return served;
  } catch (err) {
    const lastDocument = documents.at(-1);
    if (!lastDocument) throw err;
    return lastDocument;
  }
}
