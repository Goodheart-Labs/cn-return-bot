/**
 * Re-runs the pipeline's own fetch ladder (fetchWebPage in tools.ts) from this
 * VPS on every source that failed in prod. Prod runs on GitHub Actions. If the
 * ladder succeeds here on a URL it failed on there, the difference is the
 * origin address or the moment, not our client. If it fails here too, the
 * client or the site is the problem.
 *
 *   bun run src/scripts_jim/2026_09_16_unfetchable_sources/04_rerun_ladder.ts
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { fetchWebPage } from "../../pipeline/tool-calling/tools";
import { closeBrowser } from "../../pipeline/utils/browserManager";

const DIR = "src/scripts_jim/2026_09_16_unfetchable_sources/data";
const CONCURRENCY = 4;

const urls: string[] = JSON.parse(readFileSync(`${DIR}/diagnosis.json`, "utf8")).map((r: any) => r.url);
const results: any[] = [];
let next = 0;

async function worker() {
  while (next < urls.length) {
    const url = urls[next++]!;
    const started = Date.now();
    const r = await fetchWebPage(url);
    const via = r.content.match(/^\[fetched via ([^\]]+)\]/)?.[1] ?? (r.ok ? "http" : null);
    const row = { url, ok: r.ok, via, chars: r.ok ? r.content.length : 0, diagnostic: r.ok ? null : r.content.slice(0, 120), fetchedUrl: r.fetchedUrl, ms: Date.now() - started };
    results.push(row);
    console.error(`ladder ok=${r.ok} via=${via ?? "-"} ${url.slice(0, 90)}`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeFileSync(`${DIR}/candidate_ladder_from_vps.json`, JSON.stringify(results, null, 1));
console.log(`ladder from vps: ${results.filter((r) => r.ok).length}/${results.length} recovered`);
await closeBrowser().catch(() => {});
process.exit(0);
