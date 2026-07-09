/**
 * Enqueue content for the everything pipeline.
 *
 * Usage:
 *   bun run src/everything/enqueue.ts <url> [<url>...] [--latest N]
 *
 * Accepts YouTube video URLs, Substack post URLs, and Substack profile URLs
 * (https://substack.com/@handle/...) — a profile expands to its latest N free
 * posts (--latest, default 5). Already-enqueued URLs are skipped.
 */

import "dotenv/config";
import { enqueueItems } from "./db";
import { fetchLatestFreePostUrls, parseProfileHandle } from "./sources/substack";
import type { SourceKind } from "./types";

const DEFAULT_LATEST_POSTS = 5;

async function expandUrl(url: string, latest: number): Promise<{ source: SourceKind; url: string }[]> {
  if (/youtube\.com|youtu\.be/.test(url)) return [{ source: "youtube", url }];
  if (/\.substack\.com\/p\//.test(url)) return [{ source: "substack", url }];
  if (parseProfileHandle(url)) {
    const postUrls = await fetchLatestFreePostUrls(url, latest);
    console.log(`Profile ${url} → ${postUrls.length} latest free posts`);
    return postUrls.map((postUrl) => ({ source: "substack" as const, url: postUrl }));
  }
  throw new Error(`Unsupported URL (need a YouTube video, Substack post, or Substack profile): ${url}`);
}

async function main() {
  const args = process.argv.slice(2);
  const latestIdx = args.indexOf("--latest");
  const latest = latestIdx !== -1 ? Number(args[latestIdx + 1]) : DEFAULT_LATEST_POSTS;
  const urls = args.filter((a, i) => !a.startsWith("--") && i !== latestIdx + 1);
  if (urls.length === 0 || Number.isNaN(latest)) {
    console.error("Usage: bun run src/everything/enqueue.ts <url> [<url>...] [--latest N]");
    process.exit(1);
  }

  const rows = (await Promise.all(urls.map((url) => expandUrl(url, latest)))).flat();
  const inserted = await enqueueItems(rows);
  console.log(`Enqueued ${inserted} new item(s) (${rows.length - inserted} already known):`);
  for (const row of rows) console.log(`  [${row.source}] ${row.url}`);
}

main().catch((err) => {
  console.error("[enqueue] Fatal error:", err);
  process.exit(1);
});
