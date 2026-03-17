import "dotenv/config";
import { SupabaseLogger, NoteWithSnapshot } from "../api/supabaseClient";

const supabase = new SupabaseLogger();

// Get all notes with their latest snapshot data
const notes = await supabase.getNotesWithLatestSnapshots();

console.log("=== FULL BOT PERFORMANCE REPORT ===");
console.log("Total notes:", notes.length);
console.log("");

// Group by bot
const botStats: Record<
  string,
  {
    total: number;
    helpful: number;
    needsMore: number;
    notHelpful: number;
    unknown: number;
    totalViews: number;
    statusSources: { public_data: number; snapshot: number; unknown: number };
    notes: NoteWithSnapshot[];
  }
> = {};

for (const note of notes) {
  const bot = note.bot_name || "unknown";
  if (!botStats[bot]) {
    botStats[bot] = {
      total: 0,
      helpful: 0,
      needsMore: 0,
      notHelpful: 0,
      unknown: 0,
      totalViews: 0,
      statusSources: { public_data: 0, snapshot: 0, unknown: 0 },
      notes: [],
    };
  }

  botStats[bot].total++;
  botStats[bot].totalViews += note.view_count;
  botStats[bot].statusSources[note.status_source]++;

  const statusLower = note.effective_status.toLowerCase().replace(/_/g, " ");
  if (statusLower.includes("helpful") && !statusLower.includes("not")) {
    botStats[bot].helpful++;
  } else if (statusLower.includes("not helpful")) {
    botStats[bot].notHelpful++;
  } else if (statusLower.includes("needs more")) {
    botStats[bot].needsMore++;
  } else {
    botStats[bot].unknown++;
  }

  botStats[bot].notes.push(note);
}

const grandTotal = {
  notes: 0,
  helpful: 0,
  needsMore: 0,
  notHelpful: 0,
  views: 0,
  sources: { public_data: 0, snapshot: 0, unknown: 0 },
};

for (const [bot, stats] of Object.entries(botStats).sort((a, b) => b[1].total - a[1].total)) {
  const helpfulRate =
    stats.helpful + stats.notHelpful > 0
      ? ((stats.helpful / (stats.helpful + stats.notHelpful)) * 100).toFixed(1) + "%"
      : "N/A";

  console.log("---", bot.toUpperCase(), "---");
  console.log("  Total Notes:", stats.total);
  console.log("  Helpful:", stats.helpful);
  console.log("  Not Helpful:", stats.notHelpful);
  console.log("  Needs More Ratings:", stats.needsMore);
  console.log("  Unknown/Pending:", stats.unknown);
  console.log("  Helpful Rate:", helpfulRate);
  console.log("  Total Views:", stats.totalViews.toLocaleString());
  console.log(
    "  Status Sources: public_data=" +
      stats.statusSources.public_data +
      ", snapshot=" +
      stats.statusSources.snapshot +
      ", unknown=" +
      stats.statusSources.unknown,
  );
  console.log("");

  grandTotal.notes += stats.total;
  grandTotal.helpful += stats.helpful;
  grandTotal.needsMore += stats.needsMore;
  grandTotal.notHelpful += stats.notHelpful;
  grandTotal.views += stats.totalViews;
  grandTotal.sources.public_data += stats.statusSources.public_data;
  grandTotal.sources.snapshot += stats.statusSources.snapshot;
  grandTotal.sources.unknown += stats.statusSources.unknown;
}

console.log("=== GRAND TOTAL ===");
console.log("Total Notes:", grandTotal.notes);
console.log("Helpful:", grandTotal.helpful);
console.log("Not Helpful:", grandTotal.notHelpful);
console.log("Needs More Ratings:", grandTotal.needsMore);
console.log("Total Views:", grandTotal.views.toLocaleString());
const overallRate =
  grandTotal.helpful + grandTotal.notHelpful > 0
    ? ((grandTotal.helpful / (grandTotal.helpful + grandTotal.notHelpful)) * 100).toFixed(1) + "%"
    : "N/A";
console.log("Overall Helpful Rate:", overallRate);
console.log("");
console.log("=== STATUS SOURCES ===");
console.log("From Public Data:", grandTotal.sources.public_data);
console.log("From Snapshot:", grandTotal.sources.snapshot);
console.log("Unknown:", grandTotal.sources.unknown);
