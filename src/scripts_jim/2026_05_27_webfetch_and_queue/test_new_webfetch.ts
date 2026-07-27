/**
 * Run the new fetchWebPage against the full 21-URL iter-2 failure set.
 * Reports per-URL outcome and a final score we can compare to:
 *   - prod baseline: 7/21
 *   - my v2 (in test_fetch_strategies.ts): 14/21
 *   - new fetchWebPage (this script): TBD
 *
 * Run: bun src/scripts_jim/2026_05_27_webfetch_and_queue/test_new_webfetch.ts
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { fetchWebPage } from "../../pipeline/tool-calling/tools";
import { closeBrowser } from "../../pipeline/utils/browserManager";

const urls: { url: string; classification: string }[] = JSON.parse(
  fs.readFileSync(path.join(import.meta.dir, "test_urls.json"), "utf8"),
);

interface Row { url: string; chars: number; good: boolean; preview: string; took_ms: number; }

async function main() {
  const results: Row[] = [];
  for (const { url } of urls) {
    const t0 = Date.now();
    const r = await fetchWebPage(url);
    const took = Date.now() - t0;
    const out = r.content;
    const good = r.ok && out.length >= 300;
    results.push({ url, chars: out.length, good, preview: out.slice(0, 200), took_ms: took });
    console.log(`${good ? "✓" : "✗"}  ${url}`);
    console.log(`    ${out.length}c  ${took}ms  ${out.slice(0, 120).replace(/\n/g, " ")}`);
  }
  await closeBrowser().catch(() => {});

  const good = results.filter((r) => r.good).length;
  console.log(`\n=== ${good}/${results.length} good (${((good / results.length) * 100).toFixed(0)}%) ===`);
  console.log(`References — prod: 7/21 (33%) | v2 ladder only: 14/21 (67%) | crawl4ai sidecar: 13/21 (62%)`);

  fs.writeFileSync(
    path.join(import.meta.dir, "new_webfetch_results.json"),
    JSON.stringify(results, null, 2),
  );
}

await main();
