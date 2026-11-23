/**
 * Which bot check stands in front of a page, and does it let our browser
 * through? It opens each page the way the fetch ladder's browser step does
 * and prints every document the site served, with the time.
 *
 *   bun run src/scripts_jim/2026_11_20_ea_forum_without_jina/botCheckKinds.ts <pages file> <host>...
 *
 * The hosts are looked up in the pages file that jinaRescuedPages.ts wrote.
 * readerProbe.ts says how to leave through the services box's address.
 */
import { readFileSync } from "node:fs";
import { isBotCheckPage, openPastBotCheck } from "../../pipeline/fetch/botCheck";
import { FETCH_UAS } from "../../pipeline/fetch/fetchLadder";
import { closeBrowser, getBrowser } from "../../pipeline/utils/browserManager";

const [PAGES_FILE, ...hosts] = process.argv.slice(2);
if (!PAGES_FILE) throw new Error("usage: botCheckKinds.ts <pages file> <host>...");
const pages: { host: string; url: string }[] = JSON.parse(readFileSync(PAGES_FILE, "utf8"));

await Promise.all(
  pages
    .filter((page) => hosts.includes(page.host))
    .map(async ({ host, url }) => {
      const context = await (await getBrowser()).newContext({ userAgent: FETCH_UAS.desktop, viewport: { width: 1280, height: 800 }, locale: "en-US" });
      const page = await context.newPage();
      const startedAt = Date.now();
      const documents: string[] = [];
      page.on("response", (response) => {
        if (!response.request().isNavigationRequest() || response.frame() !== page.mainFrame()) return;
        const check = ["x-vercel-mitigated", "cf-mitigated"].find((name) => response.headers()[name]);
        documents.push(`${Date.now() - startedAt} ms: HTTP ${response.status()}${check ? ` ${check}=${response.headers()[check]}` : ""}`);
      });
      const outcome = await openPastBotCheck(page, url).then(
        (served) => (isBotCheckPage(served) ? "the check never let the browser through" : `served HTTP ${served.status()}`),
        (err: Error) => `error: ${err.message.slice(0, 80)}`,
      );
      console.log(`${host.padEnd(34)} ${outcome} after ${Date.now() - startedAt} ms | documents: ${documents.join("; ")}`);
      await context.close();
    }),
);
await closeBrowser();
// A page that Cloudflare's check holds keeps the process alive.
process.exit(0);
