/* Every feed-tier item enqueued in a window, in order, with when Claude took
 * it and when it finished, to see the walk's cadence and its gaps. */
import { readFileSync } from "fs";
const { items, events } = JSON.parse(readFileSync(new URL("./items.json", import.meta.url), "utf8"));
const [from, to] = [process.argv[2] ?? "2026-10-20", process.argv[3] ?? "2099"];
const takes = new Map<string, string>();
for (const e of events) if (e.type === "item_taken" && !takes.has(e.item_id)) takes.set(e.item_id, e.at);
for (const i of items.filter((i: any) => i.priority < 2 && i.created_at >= from && i.created_at < to))
  console.log([i.created_at.slice(5, 16), (takes.get(i.id)?.slice(11, 16) ?? "  -  "), (i.processed_at?.slice(5, 16) ?? "      -     "), i.status.padEnd(10), String(i.priority), (i.project?.slug ?? "?").padEnd(20), i.published_at, (i.skip_reason ?? "").slice(0, 20).padEnd(20), (i.title ?? i.url).slice(0, 45)].join(" "));
