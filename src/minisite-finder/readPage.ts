/**
 * Fetches a page through the same fetch ladder the pipeline uses (several user
 * agents, then the Wayback Machine, archive.ph and headless Chromium) and
 * prints it as markdown. It answers two questions about a minisite candidate:
 * can our fetcher read the whole article, and what does the article say.
 *
 *   bun run read-page <url>
 */

import { fetchWebPageInProcess } from "../pipeline/tool-calling/tools";
import { closeBrowser } from "../pipeline/utils/browserManager";

const url = process.argv[2];
if (!url) throw new Error("usage: bun run read-page <url>");

const page = await fetchWebPageInProcess(url);
await closeBrowser();
console.error(`${page.ok ? "fetched" : "FAILED"} ${page.fetchedUrl}, ${page.content.length} characters`);
console.log(page.content);
if (!page.ok) process.exit(1);
