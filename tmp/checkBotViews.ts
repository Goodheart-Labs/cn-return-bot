import "dotenv/config";
import { SupabaseLogger } from "../src/api/supabaseClient";
const s = new SupabaseLogger();
const notes = await s.getNotesWithLatestSnapshots();

const byBot = new Map<string, { total: number; withViews: number; totalViews: number; withSnapshot: number }>();
for (const n of notes) {
  const bot = n.bot_name || "unknown";
  if (!byBot.has(bot)) byBot.set(bot, { total: 0, withViews: 0, totalViews: 0, withSnapshot: 0 });
  const b = byBot.get(bot)!;
  b.total++;
  if (n.view_count > 0) { b.withViews++; b.totalViews += n.view_count; }
  if (n.snapshot_scraped_at) b.withSnapshot++;
}

console.log("Bot | Total | With Snapshot | With Views | Total Views");
console.log("--- | --- | --- | --- | ---");
for (const [bot, s] of [...byBot.entries()].sort((a, b) => b[1].total - a[1].total)) {
  console.log(`${bot} | ${s.total} | ${s.withSnapshot} | ${s.withViews} | ${s.totalViews.toLocaleString()}`);
}
