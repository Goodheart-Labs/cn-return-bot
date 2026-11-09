/**
 * Reads a page through the page reader the pipeline uses (a site's API, then
 * several user agents, the Wayback Machine, archive.ph and headless Chromium,
 * then Jina Reader) and prints it as markdown. It answers two questions about
 * a minisite candidate: can our fetcher read the whole article, and what does
 * the article say.
 *
 *   bun run read-page <url>
 */

import "dotenv/config";
import { readPageForModel } from "../pipeline/fetch/readPage";
import { closeBrowser } from "../pipeline/utils/browserManager";

const url = process.argv[2];
if (!url) throw new Error("usage: bun run read-page <url>");

const page = await readPageForModel(url);
await closeBrowser();
console.error(`${page.ok ? "fetched" : "FAILED"} ${page.fetchedUrl}, ${page.content.length} characters`);
console.log(page.content);
if (!page.ok) process.exit(1);
