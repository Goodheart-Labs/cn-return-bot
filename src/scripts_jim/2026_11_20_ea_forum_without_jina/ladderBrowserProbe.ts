/**
 * What the fetch ladder's browser step sees on an EA Forum page that is not a
 * post. With --page-load-headers the browser context gets BROWSER_HEADERS as
 * extra headers, as the ladder set them until GOO-832. Those headers then go
 * out with every request, the bot check's script included, and Vercel's
 * check never lets the browser through.
 *
 *   bun run src/scripts_jim/2026_11_20_ea_forum_without_jina/ladderBrowserProbe.ts [url] [--page-load-headers]
 *
 * readerProbe.ts says how to leave through the services box's address.
 */
import { isBotCheckPage, openPastBotCheck } from "../../pipeline/fetch/botCheck";
import { BROWSER_HEADERS, FETCH_UAS } from "../../pipeline/fetch/fetchLadder";
import { closeBrowser, getBrowser } from "../../pipeline/utils/browserManager";

const url = process.argv.slice(2).find((arg) => arg.startsWith("http")) ?? "https://forum.effectivealtruism.org/topics/ai-safety";
const withHeaders = process.argv.includes("--page-load-headers");
const context = await (await getBrowser()).newContext({ userAgent: FETCH_UAS.desktop, viewport: { width: 1280, height: 800 }, locale: "en-US", ...(withHeaders && { extraHTTPHeaders: { ...BROWSER_HEADERS } }) });
const page = await context.newPage();
const t0 = Date.now();
page.on("response", (r) => { if (r.request().resourceType() === "document" || r.url().includes("/.well-known/vercel/")) console.log(`${Date.now() - t0} ms  ${r.status()} ${r.headers()["x-vercel-mitigated"] ?? "-"} ${r.request().method()} ${r.url().slice(0, 100)}`); });
const served = await openPastBotCheck(page, url);
console.log(`${Date.now() - t0} ms  served: HTTP ${served.status()}, bot check page: ${isBotCheckPage(served)}`);
await page.waitForLoadState("domcontentloaded", { timeout: 20_000 });
await page.waitForTimeout(1_500);
console.log(`title: ${await page.title()}, ${(await page.content()).length} characters of HTML`);
await closeBrowser();
