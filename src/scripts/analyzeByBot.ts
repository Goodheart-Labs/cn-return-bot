import { getSupabaseClient } from "../api/supabaseClient";

async function main() {
  const client = getSupabaseClient();

  // Get all snapshots
  const { data: snapshots } = await client
    .from("scraped_notewriter_snapshots")
    .select("note_id, cn_status, view_count, scraped_at")
    .order("scraped_at", { ascending: false });

  console.log("Total snapshots:", snapshots?.length);

  // Get latest status per note
  const latestStatus: Record<string, string> = {};
  for (const s of snapshots || []) {
    if (!latestStatus[s.note_id]) {
      latestStatus[s.note_id] = s.cn_status || "Unknown";
    }
  }
  console.log("Unique notes:", Object.keys(latestStatus).length);

  // Count statuses
  const statusCounts: Record<string, number> = {};
  for (const status of Object.values(latestStatus)) {
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  console.log("\nStatus breakdown:");
  console.log(statusCounts);

  // Get notes table with bot info
  const { data: notes } = await client
    .from("notes")
    .select("note_id, bot_name, cn_status, view_count");

  console.log("\nNotes in 'notes' table:", notes?.length);

  // Map note_id to bot_name
  const noteToBotMap: Record<string, string> = {};
  for (const n of notes || []) {
    noteToBotMap[n.note_id] = n.bot_name || "unknown";
  }

  // Count by bot and status
  const botStats: Record<string, { helpful: number; needs_more: number; not_helpful: number; not_shown: number; total: number }> = {};

  for (const [noteId, status] of Object.entries(latestStatus)) {
    const bot = noteToBotMap[noteId] || "not-bot-submitted";

    if (!botStats[bot]) {
      botStats[bot] = { helpful: 0, needs_more: 0, not_helpful: 0, not_shown: 0, total: 0 };
    }
    botStats[bot].total++;

    const normalizedStatus = status.toUpperCase();
    if (normalizedStatus.includes("NOT_SHOWN") || normalizedStatus.includes("NOT SHOWN")) {
      botStats[bot].not_shown++;
    } else if (normalizedStatus.includes("CURRENTLY") && normalizedStatus.includes("HELPFUL")) {
      if (normalizedStatus.includes("NOT")) {
        botStats[bot].not_helpful++;
      } else {
        botStats[bot].helpful++;
      }
    } else {
      botStats[bot].needs_more++;
    }
  }

  console.log("\nBy bot (including not_shown):");
  for (const [bot, stats] of Object.entries(botStats).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${bot}: ${stats.total} total | ${stats.helpful} helpful | ${stats.needs_more} needs more | ${stats.not_helpful} not helpful | ${stats.not_shown} not shown`);
  }

  // Also show just the bot-submitted notes
  console.log("\n=== BOT-SUBMITTED NOTES ONLY ===");
  const botOnlyStats = Object.entries(botStats).filter(([bot]) => bot !== "not-bot-submitted");
  let totals = { helpful: 0, needs_more: 0, not_helpful: 0, not_shown: 0, total: 0 };
  for (const [bot, stats] of botOnlyStats.sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${bot}: ${stats.total} total | ${stats.helpful} helpful | ${stats.needs_more} needs more | ${stats.not_helpful} not helpful | ${stats.not_shown} not shown`);
    totals.helpful += stats.helpful;
    totals.needs_more += stats.needs_more;
    totals.not_helpful += stats.not_helpful;
    totals.not_shown += stats.not_shown;
    totals.total += stats.total;
  }
  console.log(`  TOTAL: ${totals.total} total | ${totals.helpful} helpful | ${totals.needs_more} needs more | ${totals.not_helpful} not helpful | ${totals.not_shown} not shown`);

  // Check notes table directly
  console.log("\n=== FROM 'notes' TABLE DIRECTLY ===");
  const notesByBot: Record<string, { helpful: number; needs_more: number; total: number }> = {};
  for (const n of notes || []) {
    const bot = n.bot_name || "unknown";
    if (!notesByBot[bot]) {
      notesByBot[bot] = { helpful: 0, needs_more: 0, total: 0 };
    }
    notesByBot[bot].total++;
    if (n.cn_status === "CURRENTLY_RATED_HELPFUL") {
      notesByBot[bot].helpful++;
    } else {
      notesByBot[bot].needs_more++;
    }
  }
  for (const [bot, stats] of Object.entries(notesByBot).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${bot}: ${stats.total} total | ${stats.helpful} helpful | ${stats.needs_more} needs more`);
  }
}

main().catch(console.error);
