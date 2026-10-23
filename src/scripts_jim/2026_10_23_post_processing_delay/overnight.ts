/* What Nathan's overnight Claude run on 2026-10-23 took: the items' tier,
 * creator, age and status, and the events it wrote around them (GOO-549). */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows } from "../../everything-core/paging";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
type Event = { id: number; at: string; actor: string; type: string; item_id: string | null; data: any };
const events = await fetchAllRows<Event>(() => db.from("everything_claude_events").select("id, at, actor, type, item_id, data").gte("at", "2026-10-22T18:00:00Z"), "id", { label: "events" });
const overnight = events.filter((e) => e.type === "item_taken" && e.data?.by?.startsWith("nathan-mac"));
const ids = overnight.map((e) => e.item_id!);
const items = await fetchAllRows<any>(() => db.from("everything_items").select("id, url, title, status, priority, checked_scope, created_at, processed_at, published_at, project:everything_projects(slug)").in("id", ids), "id", { label: "items" });
const tally = (f: (i: any) => string) => { const m = new Map<string, number>(); for (const i of items) m.set(f(i), (m.get(f(i)) ?? 0) + 1); return Object.fromEntries([...m].sort((a, b) => b[1] - a[1]).slice(0, 12)); };
console.log("tier:", tally((i) => String(i.priority)));
console.log("creator:", tally((i) => i.project?.slug ?? "-"));
console.log("enqueued month:", tally((i) => i.created_at.slice(0, 7)));
console.log("status now:", tally((i) => i.status));
console.log("event types between 06:00 and 09:30 by actor and by-field:");
const window = events.filter((e) => e.at >= "2026-10-23T06:00" && e.at <= "2026-10-23T09:30");
const kinds = new Map<string, number>();
for (const e of window) { const k = `${e.actor} ${e.type} ${e.data?.by ? "[by " + e.data.by + "]" : ""}`; kinds.set(k, (kinds.get(k) ?? 0) + 1); }
console.log(Object.fromEntries(kinds));
console.log("sample data fields:", JSON.stringify(window.find((e) => e.type === "item_finished" && ids.includes(e.item_id!))?.data).slice(0, 400));
console.log("Jim's session takes (no by) since 2026-10-22 18:00:", events.filter((e) => e.type === "item_taken" && !e.data?.by).map((e) => e.at.slice(5, 16)).join(", "));

// Had Jim's standing session taken these items before, and did it finish them?
const all = await fetchAllRows<Event>(() => db.from("everything_claude_events").select("id, at, actor, type, item_id, data").in("item_id", ids).in("type", ["item_taken", "item_finished", "item_skipped", "handed_back"]), "id", { label: "item events" });
const runs = await fetchAllRows<{ id: string; item_id: string; created_at: string }>(() => db.from("everything_pipeline_runs").select("id, item_id, created_at").in("item_id", ids), "id", { label: "runs" });
const history = new Map<string, number>();
for (const take of overnight) {
  const before = all.filter((e) => e.item_id === take.item_id && e.at < take.at);
  const jimTook = before.some((e) => e.type === "item_taken" && !e.data?.by);
  const finished = before.some((e) => e.type === "item_finished" || e.type === "item_skipped");
  const pipeline = runs.some((r) => r.item_id === take.item_id && r.created_at < take.at);
  const k = `jim's session took it: ${jimTook}, finished before: ${finished}, pipeline ran before: ${pipeline}`;
  history.set(k, (history.get(k) ?? 0) + 1);
}
console.log(Object.fromEntries(history));
const neverTaken = overnight.filter((t) => !all.some((e) => e.item_id === t.item_id && e.at < t.at) && !runs.some((r) => r.item_id === t.item_id && r.created_at < t.at));
console.log("never touched before, sample:", neverTaken.slice(0, 6).map((t) => { const i = items.find((x: any) => x.id === t.item_id); return `${i.created_at.slice(0, 10)} t${i.priority} ${i.project?.slug} ${(i.title ?? i.url).slice(0, 40)}`; }));

// For the untouched ones: how long between the item's creation and the overnight take?
const gaps = neverTaken.map((t) => { const i = items.find((x: any) => x.id === t.item_id); return (Date.parse(t.at) - Date.parse(i.created_at)) / 60000; }).sort((a, b) => a - b);
console.log("minutes from item creation to overnight take, quartiles:", [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => Math.round(gaps[Math.floor(q * (gaps.length - 1))]!)));
const created = neverTaken.map((t) => items.find((x: any) => x.id === t.item_id).created_at).sort();
console.log("their creation times:", created[0], "to", created.at(-1));
