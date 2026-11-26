/** Does X keep the XXL feed in the same order between walks (GOO-880)? It reads
 *  the first PAGES pages of XXL several times, at the minutes in READ_AT_MINUTES,
 *  and compares each read with the first one: which posts are still there, and
 *  how far they moved. A post gets a predicted-views score only when two walks
 *  10 minutes apart both read it, so the 10-minute pair is the one that counts.
 *  It stops a read while X has fewer than SAFE_RATE_REMAINING requests left, so
 *  cn-feed-views' walk of about 102 requests stays whole. Runs on the services
 *  box like xxlProbe.ts, and writes the raw reads to /tmp/xxlStability.json.
 */
import { walkEligiblePages } from "/opt/cn-return-bot/src/api/fetchEligiblePosts";
import { buildPostSelection } from "/opt/cn-return-bot/src/pipeline/orchestration/utils/feedSizeStrategy";

const PAGES = 50;
const READ_AT_MINUTES = [0, 2, 10, 20];
const SAFE_RATE_REMAINING = 300;

type Read = { minute: number; at: string; ids: string[]; pageOf: number[]; pages: number; stop: string };

async function readXxl(minute: number): Promise<Read> {
  const ids: string[] = [], pageOf: number[] = [];
  let pages = 0, stop = "page limit";
  for await (const page of walkEligiblePages(buildPostSelection("xxl"))) {
    pages++;
    for (const p of page.posts) { ids.push(p.id); pageOf.push(pages); }
    if (page.isLastPage) { stop = "end of the feed"; break; }
    if (pages >= PAGES) break;
    if ((page.rateRemaining ?? 0) < SAFE_RATE_REMAINING) { stop = `rate left ${page.rateRemaining}`; break; }
  }
  return { minute, at: new Date().toISOString(), ids, pageOf, pages, stop };
}

function compare(first: Read, later: Read) {
  const laterIndex = new Map(later.ids.map((id, i) => [id, i]));
  const pagesCompared = Math.min(first.pages, later.pages);
  const kept = first.ids.filter((_, i) => first.pageOf[i] <= pagesCompared);
  const found = kept.filter((id) => laterIndex.has(id));
  const shifts = kept.flatMap((id, i) => (laterIndex.has(id) ? [laterIndex.get(id)! - i] : [])).sort((a, b) => a - b);
  const samePlace = kept.filter((id, i) => laterIndex.get(id) === i).length;
  const byTenPages = Array.from({ length: Math.ceil(pagesCompared / 10) }, (_, d) => {
    const inBand = kept.filter((_, i) => Math.ceil(first.pageOf[i] / 10) === d + 1);
    return `${d * 10 + 1}-${d * 10 + 10}: ${Math.round((100 * inBand.filter((id) => laterIndex.has(id)).length) / Math.max(1, inBand.length))}%`;
  });
  const q = (f: number) => shifts[Math.floor(f * (shifts.length - 1))] ?? null;
  console.log(
    `minute ${first.minute} vs minute ${later.minute} (first ${pagesCompared} pages): ${found.length} of ${kept.length} posts still there (${Math.round((100 * found.length) / kept.length)}%), ${samePlace} at exactly the same place, position change p10 ${q(0.1)} median ${q(0.5)} p90 ${q(0.9)}, still there by page band of the first read: ${byTenPages.join(", ")}`,
  );
}

const reads: Read[] = [];
const start = Date.now();
for (const minute of READ_AT_MINUTES) {
  const wait = start + minute * 60_000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const read = await readXxl(minute);
  reads.push(read);
  console.log(`read at minute ${minute} (${read.at}): ${read.pages} pages, ${read.ids.length} posts, ${new Set(read.ids).size} distinct, stopped by ${read.stop}`);
}
await Bun.write("/tmp/xxlStability.json", JSON.stringify(reads));
for (const later of reads.slice(1)) compare(reads[0], later);
for (let i = 1; i + 1 < reads.length; i++) compare(reads[i], reads[i + 1]);
