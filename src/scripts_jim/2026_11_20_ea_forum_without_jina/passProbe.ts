/**
 * Does the pass that Vercel's bot check gives our browser carry over to the
 * browser's next visit? The first visit opens the API address itself, waits
 * for the check to let it through and keeps the cookies. The second visit is a
 * new browser context that starts with those cookies.
 *
 *   bun run src/scripts_jim/2026_11_20_ea_forum_without_jina/passProbe.ts
 *
 * It leaves through the services box's address, so it needs
 * `ssh -N -D 127.0.0.1:1081 root@<services box>` running.
 */
import { chromium, type BrowserContext, type Response } from "playwright";
import { FETCH_UAS } from "../../pipeline/fetch/fetchLadder";

const ADDRESS = `https://forum.effectivealtruism.org/graphql?query=${encodeURIComponent('{ posts(input:{terms:{view:"new",limit:3}}){results{_id title}}}')}`;
const isBotCheck = (response: Response) => response.headers()["x-vercel-mitigated"] === "challenge";

const browser = await chromium.launch({ proxy: { server: "socks5://127.0.0.1:1081" }, args: ["--disable-blink-features=AutomationControlled"] });

async function visit(label: string, context: BrowserContext): Promise<void> {
  const startedAt = Date.now();
  const page = await context.newPage();
  let documents = 0;
  const isAnswer = (response: Response) => {
    if (!response.request().isNavigationRequest() || response.frame() !== page.mainFrame()) return false;
    documents++;
    return !isBotCheck(response);
  };
  const [answer] = await Promise.all([page.waitForResponse(isAnswer, { timeout: 20_000 }), page.goto(ADDRESS, { waitUntil: "commit" })]);
  const body = await answer.text();
  console.log(`${label}: ${documents} document requests, HTTP ${answer.status()} after ${Date.now() - startedAt} ms, ${body.length} characters: ${body.slice(0, 90)}`);
}

const first = await browser.newContext({ userAgent: FETCH_UAS.desktop, locale: "en-US" });
await visit("first visit ", first);
const cookies = await first.cookies();
for (const cookie of cookies) console.log(`  cookie ${cookie.name} lasts ${cookie.expires > 0 ? `${Math.round((cookie.expires - Date.now() / 1000) / 60)} minutes` : "until the browser closes"}`);
await first.close();

const second = await browser.newContext({ userAgent: FETCH_UAS.desktop, locale: "en-US", storageState: { cookies, origins: [] } });
await visit("second visit", second);
await second.close();

const third = await browser.newContext({ userAgent: FETCH_UAS.desktop, locale: "en-US" });
await visit("a visit without the cookies", third);
await browser.close();
