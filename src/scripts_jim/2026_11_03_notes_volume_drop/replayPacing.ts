import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { computeClaudePacing, USAGE_WINDOW_HOURS, USAGE_WINDOW_NOT_BEFORE, type UsageReading } from "../../everything/usagePacing";

/** Replays the usage pacing every 3 hours from Oct 26 to now with the real
 *  readings and item_taken events, so we see what interval each feed run would
 *  have computed. It also prints the raw readings around the Nov 1 reset. */
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const PAGE = 1000;
const STEP_HOURS = 3;
const REPLAY_FROM = new Date("2026-10-26T00:00:00Z");

async function fetchAll(table: string, columns: string, timeColumn: string, filter?: (q: any) => any) {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db.from(table).select(columns).gte(timeColumn, USAGE_WINDOW_NOT_BEFORE.toISOString()).order(timeColumn).range(from, from + PAGE - 1);
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

const readings: UsageReading[] = (await fetchAll("everything_claude_usage", "at, weekly, weekly_resets_at", "at")).map((r) => ({
  at: new Date(r.at), weekly: r.weekly, weeklyResetsAt: r.weekly_resets_at ? new Date(r.weekly_resets_at) : null,
}));
const takenAt: Date[] = (await fetchAll("everything_claude_events", "at", "at", (q) => q.eq("type", "item_taken"))).map((e) => new Date(e.at));

console.log("Raw readings Oct 31 18:00 to Nov 1 13:00:");
for (const r of readings.filter((r) => r.at >= new Date("2026-10-31T18:00Z") && r.at <= new Date("2026-11-01T13:00Z"))) {
  console.log(`  ${r.at.toISOString().slice(0, 16)} ${r.weekly}% resets ${r.weeklyResetsAt?.toISOString().slice(0, 16)}`);
}

console.log("\nReplayed pacing:");
for (let now = REPLAY_FROM; now <= new Date(); now = new Date(now.getTime() + STEP_HOURS * 3600_000)) {
  const since = new Date(Math.max(now.getTime() - USAGE_WINDOW_HOURS * 3600_000, USAGE_WINDOW_NOT_BEFORE.getTime()));
  const windowReadings = readings.filter((r) => r.at >= since && r.at <= now);
  const windowTaken = takenAt.filter((t) => t >= since && t <= now);
  const pacing = computeClaudePacing({ now, readings: windowReadings, postsTaken: windowTaken.length, lastTakenAt: windowTaken.at(-1) ?? null });
  if (pacing.kind !== "paced") { console.log(now.toISOString().slice(0, 16), pacing.reason); continue; }
  const postsPerDay = pacing.intervalMs === Infinity ? 0 : (24 * 3600_000) / pacing.intervalMs;
  console.log(`${now.toISOString().slice(0, 16)} usage ${String(pacing.weekly).padStart(3)}%  reset ${pacing.resetsAt.toISOString().slice(5, 16)}  ` +
    `${pacing.usagePerPost.toFixed(3)}%/post (${windowTaken.length} posts in window)  → ${postsPerDay.toFixed(0)} posts/day`);
}
