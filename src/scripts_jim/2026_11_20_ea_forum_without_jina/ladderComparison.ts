/**
 * Runs the fetch ladder on the pages that only Jina could read last week
 * (the pages file that jinaRescuedPages.ts wrote) and writes what each got to
 * ladder_results_<label>.json next to that file. Run it once in this checkout
 * and once in a checkout of main to compare the two ladders on the same pages
 * at the same time. readerProbe.ts says how to leave through the services
 * box's address.
 *
 *   bun run src/scripts_jim/2026_11_20_ea_forum_without_jina/ladderComparison.ts <label> <pages file>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fetchPageWithLadder } from "../../pipeline/fetch/fetchLadder";
import { closeBrowser } from "../../pipeline/utils/browserManager";

const PAGES_AT_ONCE = 4;

const [label, PAGES_FILE] = process.argv.slice(2);
if (!label || !PAGES_FILE) throw new Error("usage: ladderComparison.ts <label> <pages file>");
const RESULTS_FOLDER = dirname(PAGES_FILE);
const pages: { host: string; url: string }[] = JSON.parse(readFileSync(PAGES_FILE, "utf8"));

interface LadderResult {
  host: string;
  url: string;
  ok: boolean;
  via: string | null;
  chars: number;
  diagnostic: string | null;
  ms: number;
}

const results: LadderResult[] = [];
const waiting = [...pages];
async function worker(): Promise<void> {
  for (let page = waiting.shift(); page; page = waiting.shift()) {
    const startedAt = Date.now();
    const ladder = await fetchPageWithLadder(page.url);
    const result = { ...page, ok: ladder.ok, via: ladder.ok ? (ladder.via ?? "plain request") : null, chars: ladder.ok ? ladder.markdown.length : 0, diagnostic: ladder.ok ? null : ladder.diagnostic, ms: Date.now() - startedAt };
    results.push(result);
    console.log(`${results.length}/${pages.length} ${result.host}: ${result.ok ? `read via ${result.via}` : result.diagnostic} (${result.ms} ms)`);
  }
}
await Promise.all(Array.from({ length: PAGES_AT_ONCE }, worker));
await closeBrowser();

writeFileSync(`${RESULTS_FOLDER}/ladder_results_${label}.json`, JSON.stringify(results, null, 2));
const read = results.filter((result) => result.ok);
const byStep = new Map<string, number>();
for (const result of read) byStep.set(result.via!, (byStep.get(result.via!) ?? 0) + 1);
console.log(`\n${label}: the ladder read ${read.length} of ${results.length} pages: ${[...byStep].map(([via, count]) => `${count} via ${via}`).join(", ")}`);
