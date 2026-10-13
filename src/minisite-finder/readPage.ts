/**
 * Fetches a page through the same fetch ladder the pipeline uses (several user
 * agents, then the Wayback Machine, archive.ph and headless Chromium) and
 * prints it as markdown. It answers two questions about a minisite candidate:
 * can our fetcher read the whole article, and what does the article say.
 *
 *   bun run read-page <url>
 *   bun run read-page <url> --max 200000
 */

import { fetchWebPageInProcess } from "../pipeline/tool-calling/tools";

const DEFAULT_MAX_CHARS = 100_000;

const url = process.argv[2];
if (!url) throw new Error("usage: bun run read-page <url> [--max <chars>]");
const maxIndex = process.argv.indexOf("--max");
const maxChars = maxIndex === -1 ? DEFAULT_MAX_CHARS : Number(process.argv[maxIndex + 1]);

const page = await fetchWebPageInProcess(url, { maxChars });
console.error(`${page.ok ? "fetched" : "FAILED"} ${page.fetchedUrl}, ${page.content.length} characters`);
console.log(page.content);
if (!page.ok) process.exit(1);
