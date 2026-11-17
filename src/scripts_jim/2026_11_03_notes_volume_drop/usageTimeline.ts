import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

/** Prints, per 6-hour window, the weekly usage reading, the Claude runs by tag
 *  with their reported cost, and the Claude events by type, from Oct 27 to now. */
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SINCE = "2026-10-27";
const PAGE = 1000;
const WINDOW_HOURS = 6;

async function fetchAll(table: string, columns: string, timeColumn: string) {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).gte(timeColumn, SINCE).order(timeColumn).range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

const [usage, runs, events] = await Promise.all([
  fetchAll("everything_claude_usage", "at, weekly, weekly_resets_at", "at"),
  fetchAll("everything_claude_runs", "started_at, ended_at, tags, api_cost_usd", "started_at"),
  fetchAll("everything_claude_events", "at, type, item_id", "at"),
]);

function windowKey(iso: string) {
  const d = new Date(iso);
  d.setUTCHours(Math.floor(d.getUTCHours() / WINDOW_HOURS) * WINDOW_HOURS, 0, 0, 0);
  return d.toISOString().slice(0, 13);
}

type Window = { usage: number[]; resets: Set<string>; runs: Record<string, number>; cost: Record<string, number>; events: Record<string, number> };
const windows = new Map<string, Window>();
function windowAt(iso: string) {
  const key = windowKey(iso);
  if (!windows.has(key)) windows.set(key, { usage: [], resets: new Set(), runs: {}, cost: {}, events: {} });
  return windows.get(key)!;
}

for (const u of usage) {
  const w = windowAt(u.at);
  w.usage.push(u.weekly);
  if (u.weekly_resets_at) w.resets.add(u.weekly_resets_at.slice(0, 16));
}
for (const r of runs) {
  const w = windowAt(r.started_at);
  const tag = (r.tags as string[]).join(",");
  w.runs[tag] = (w.runs[tag] ?? 0) + 1;
  w.cost[tag] = (w.cost[tag] ?? 0) + (r.api_cost_usd ?? 0);
}
for (const e of events) {
  const w = windowAt(e.at);
  w.events[e.type] = (w.events[e.type] ?? 0) + 1;
}

for (const [key, w] of [...windows].sort()) {
  const usageText = w.usage.length ? `${Math.min(...w.usage)}-${Math.max(...w.usage)}%` : "no reading";
  const runText = Object.entries(w.runs).map(([tag, n]) => `${tag}:${n} ($${w.cost[tag].toFixed(0)})`).join(" ");
  console.log(`${key}h usage ${usageText.padEnd(10)} reset ${[...w.resets].join("/")}  runs ${runText}`);
  console.log(`              events ${JSON.stringify(w.events)}`);
}
