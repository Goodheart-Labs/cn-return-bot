/* Splits each feed post's delay into discovery (publication day to enqueue)
 * and processing (enqueue to finished), per creator, before and after the
 * Claude note writer took over on 2026-10-21 15:13 UTC. */
import { readFileSync } from "fs";
const { items, events } = JSON.parse(readFileSync(new URL("./items.json", import.meta.url), "utf8"));
const CLAUDE_SINCE = "2026-10-21T15:13";
const h = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3.6e6;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const takes = new Map<string, string>();
for (const e of events) if (e.type === "item_taken" && !takes.has(e.item_id)) takes.set(e.item_id, e.at);
const feed = items.filter((i: any) => i.priority < 2 && i.project?.feed_url && i.published_at && i.published_at >= i.created_at.slice(0, 10).replace(/\d\d$/, (d: string) => String(Math.max(1, +d - 2)).padStart(2, "0")));
console.log("feed items created since Oct 1, published within ~2 days before enqueue:", feed.length);
const rows = feed.map((i: any) => ({
  creator: i.project.slug, prio: i.project.priority_until > new Date().toISOString(), src: i.source,
  pub: i.published_at, created: i.created_at.slice(0, 16), processed: i.processed_at?.slice(0, 16) ?? "-",
  status: i.status, discoverH: h(i.published_at + "T00:00Z", i.created_at), processH: i.processed_at ? h(i.created_at, i.processed_at) : NaN,
  takeH: takes.has(i.id) ? h(i.created_at, takes.get(i.id)!) : NaN, era: i.created_at >= CLAUDE_SINCE ? "claude" : "pipeline", title: (i.title ?? i.url).slice(0, 40),
}));
for (const era of ["pipeline", "claude"]) {
  const r = rows.filter((x: any) => x.era === era && x.prio);
  console.log(`\n== ${era} era, priority creators: ${r.length} posts`);
  console.log("median publication-day-midnight -> enqueue h", median(r.map((x: any) => x.discoverH)).toFixed(1));
  const done = r.filter((x: any) => !isNaN(x.processH));
  console.log("median enqueue -> processed h", median(done.map((x: any) => x.processH)).toFixed(2), "over", done.length);
}
console.log("\nclaude era rows, priority creators:");
for (const x of rows.filter((x: any) => x.era === "claude" && x.prio)) console.log([x.creator.padEnd(22), x.src.padEnd(9), x.pub, x.created, x.processed, x.status.padEnd(10), x.discoverH.toFixed(1).padStart(5), (isNaN(x.takeH) ? "-" : x.takeH.toFixed(1)).padStart(5), x.processH.toFixed(1).padStart(5), x.title].join(" "));
