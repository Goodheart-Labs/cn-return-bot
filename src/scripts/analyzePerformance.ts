import "dotenv/config";
import { SupabaseLogger } from "../api/supabaseClient";

const supabase = new SupabaseLogger();
const notes = await supabase.getNotesWithLatestSnapshots();

// Analyze by bot
const analysis: Record<string, { helpful: number; notHelpful: number; needsMore: number; unknown: number; total: number }> = {};
for (const note of notes) {
  const bot = note.bot_name || "unknown";
  if (!analysis[bot]) {
    analysis[bot] = { helpful: 0, notHelpful: 0, needsMore: 0, unknown: 0, total: 0 };
  }
  analysis[bot].total++;

  const status = note.effective_status?.toLowerCase().replace(/_/g, " ") || "";
  if (status.includes("helpful") && !status.includes("not")) {
    analysis[bot].helpful++;
  } else if (status.includes("not helpful")) {
    analysis[bot].notHelpful++;
  } else if (status.includes("needs more")) {
    analysis[bot].needsMore++;
  } else {
    analysis[bot].unknown++;
  }
}

// Calculate rates and sort by delta
const results: Array<{
  bot: string;
  helpful: number;
  notHelpful: number;
  needsMore: number;
  total: number;
  helpfulRate: string;
  notHelpfulRate: string;
  delta: string;
  deltaNum: number;
}> = [];

for (const [bot, stats] of Object.entries(analysis)) {
  const known = stats.helpful + stats.notHelpful + stats.needsMore;
  const helpfulRate = known > 0 ? ((stats.helpful / known) * 100).toFixed(1) : "N/A";
  const notHelpfulRate = known > 0 ? ((stats.notHelpful / known) * 100).toFixed(1) : "N/A";
  const deltaNum = known > 0 ? (stats.helpful - stats.notHelpful) / known * 100 : 0;
  const delta = known > 0 ? deltaNum.toFixed(1) : "N/A";

  results.push({
    bot,
    helpful: stats.helpful,
    notHelpful: stats.notHelpful,
    needsMore: stats.needsMore,
    total: stats.total,
    helpfulRate,
    notHelpfulRate,
    delta,
    deltaNum,
  });
}

// Sort by delta (helpful - notHelpful rate)
results.sort((a, b) => b.deltaNum - a.deltaNum);

console.log("=== BOT PERFORMANCE ANALYSIS ===\n");
console.log("Sorted by (helpful - notHelpful) rate:\n");

for (const r of results) {
  console.log(`${r.bot}:`);
  console.log(`  Total: ${r.total}, Helpful: ${r.helpful}, Not Helpful: ${r.notHelpful}, Needs More: ${r.needsMore}`);
  console.log(`  Helpful Rate: ${r.helpfulRate}%, Not Helpful Rate: ${r.notHelpfulRate}%`);
  console.log(`  Delta (H - NH): ${r.delta}%`);
  console.log("");
}
