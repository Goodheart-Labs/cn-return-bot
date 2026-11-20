/**
 * Which pages could only Jina read? The page reader recorded every read from
 * 2026-11-12 to 2026-11-19 in the table page_reads (GOO-766). This lists the
 * page reads of that week by outcome and by the step that served them, and
 * writes one page per site that Jina served to the given file, as the test
 * set for ladderComparison.ts. The file holds addresses from production
 * reads, so it belongs outside the repository, which is public.
 *
 *   bun run src/scripts_jim/2026_11_20_ea_forum_without_jina/jinaRescuedPages.ts <pages file>
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { getSupabaseClient } from "../../api/supabaseClient";
import { fetchAllRows } from "../../everything-core/paging";

const OUT_FILE = process.argv[2];
if (!OUT_FILE) throw new Error("usage: jinaRescuedPages.ts <pages file>");
const PAGES_IN_TEST_SET = 60;

interface PageReadRow {
  id: string;
  input: string;
  outcome: string;
  via: string | null;
}

const rows = await fetchAllRows<PageReadRow>(() => getSupabaseClient().from("page_reads").select("id, input, outcome, via").eq("kind", "page"), "id", { label: "page_reads" });

const counts = new Map<string, number>();
for (const row of rows) counts.set(`${row.outcome} via ${row.via ?? "-"}`, (counts.get(`${row.outcome} via ${row.via ?? "-"}`) ?? 0) + 1);
console.log(`${rows.length} page reads from 2026-11-12 to 2026-11-19:`);
for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(6)}  ${key}`);

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};
const jinaPages = rows.filter((row) => row.via?.toLowerCase().includes("jina"));
const pagesPerHost = new Map<string, string[]>();
for (const row of jinaPages) {
  const host = hostOf(row.input);
  if (host) pagesPerHost.set(host, [...(pagesPerHost.get(host) ?? []), row.input]);
}
const hostsByReads = [...pagesPerHost].sort((a, b) => b[1].length - a[1].length);
console.log(`\nJina served ${jinaPages.length} of them, on ${hostsByReads.length} sites. The sites with the most:`);
for (const [host, urls] of hostsByReads.slice(0, 25)) console.log(`  ${String(urls.length).padStart(5)}  ${host}`);

const testSet = hostsByReads.slice(0, PAGES_IN_TEST_SET).map(([host, urls]) => ({ host, readsServedByJina: urls.length, url: urls[0] }));
writeFileSync(OUT_FILE, JSON.stringify(testSet, null, 2));
console.log(`\nwrote ${testSet.length} pages to ${OUT_FILE}`);
