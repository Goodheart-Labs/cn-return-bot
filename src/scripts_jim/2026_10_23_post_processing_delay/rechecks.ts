/* Which items were checked more than once, and what started each extra check
 * (GOO-549). Read-only. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows } from "../../everything-core/paging";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
type Event = { id: number; at: string; actor: string; type: string; item_id: string | null; data: any };
const events = await fetchAllRows<Event>(() => db.from("everything_claude_events").select("id, at, actor, type, item_id, data").not("item_id", "is", null), "id", { label: "events" });
const byItem = new Map<string, Event[]>();
for (const e of events) byItem.set(e.item_id!, [...(byItem.get(e.item_id!) ?? []), e]);
const types = new Map<string, number>();
for (const e of events) types.set(e.type, (types.get(e.type) ?? 0) + 1);
console.log("event types:", Object.fromEntries(types));
const takers = new Map<string, number>();
for (const e of events.filter((e) => e.type === "item_taken")) { const by = e.data?.by ?? "(no by)"; takers.set(by, (takers.get(by) ?? 0) + 1); }
console.log("item_taken by:", Object.fromEntries(takers));
const finishedTwice = [...byItem].filter(([, es]) => es.filter((e) => e.type === "item_finished").length > 1);
console.log("items finished more than once by Claude:", finishedTwice.length);
const importedOnly = [...byItem].filter(([, es]) => es.some((e) => e.type === "draft_written" && e.data?.imported));
console.log("items with imported drafts:", importedOnly.length, "first", importedOnly.map(([, es]) => es[0]!.at).sort()[0], "last", importedOnly.map(([, es]) => es[0]!.at).sort().at(-1));
// For each item Claude took, was it already done when taken? Use the pipeline's run times as the earlier check.
const takenIds = [...new Set(events.filter((e) => e.type === "item_taken").map((e) => e.item_id!))];
const runs = await fetchAllRows<{ id: string; item_id: string; created_at: string }>(() => db.from("everything_pipeline_runs").select("id, item_id, created_at").in("item_id", takenIds.slice(0, 200)), "id", { label: "runs" });
const firstRun = new Map<string, string>();
for (const r of runs) if (!firstRun.has(r.item_id) || r.created_at < firstRun.get(r.item_id)!) firstRun.set(r.item_id, r.created_at);
let afterPipeline = 0;
for (const id of takenIds.slice(0, 200)) { const take = byItem.get(id)!.find((e) => e.type === "item_taken")!; if (firstRun.has(id) && firstRun.get(id)! < take.at) afterPipeline++; }
console.log(`of the first ${Math.min(200, takenIds.length)} items Claude took, ${afterPipeline} had pipeline runs before the take`);
for (const [id, es] of finishedTwice.slice(0, 8)) console.log(id.slice(0, 8), es.filter((e) => ["item_taken", "item_finished"].includes(e.type)).map((e) => `${e.at.slice(5, 16)} ${e.type}${e.data?.by ? ` (${e.data.by})` : ""}`).join(" | "));

// Nathan's overnight takes: was the item already checked before, by Claude or the pipeline?
const overnight = events.filter((e) => e.type === "item_taken" && e.data?.by?.startsWith("nathan-mac"));
const overnightIds = overnight.map((e) => e.item_id!);
const items = await fetchAllRows<{ id: string; created_at: string; priority: number; project_id: string | null }>(() => db.from("everything_items").select("id, created_at, priority, project_id").in("id", overnightIds), "id", { label: "overnight items" });
const overnightRuns = await fetchAllRows<{ id: string; item_id: string; created_at: string }>(() => db.from("everything_pipeline_runs").select("id, item_id, created_at").in("item_id", overnightIds), "id", { label: "overnight runs" });
let checkedBefore = 0, byClaude = 0, byPipeline = 0;
for (const take of overnight) {
  const claudeBefore = (byItem.get(take.item_id!) ?? []).some((e) => e.type === "item_finished" && e.at < take.at);
  const pipelineBefore = overnightRuns.some((r) => r.item_id === take.item_id && r.created_at < take.at);
  if (claudeBefore || pipelineBefore) checkedBefore++;
  if (claudeBefore) byClaude++;
  else if (pipelineBefore) byPipeline++;
}
console.log(`overnight takes ${overnight.length}: ${checkedBefore} were checked before (${byClaude} by Claude, ${byPipeline} by the pipeline only); first ${overnight.map((e) => e.at).sort()[0]}, last ${overnight.map((e) => e.at).sort().at(-1)}`);
console.log("overnight items created:", items.map((i) => i.created_at.slice(0, 10)).sort()[0], "to", items.map((i) => i.created_at.slice(0, 10)).sort().at(-1));
