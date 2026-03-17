import { getSupabaseClient } from "../api/supabaseClient";

async function main() {
  const client = getSupabaseClient();

  // Get all notes with status info
  const { data: notes } = await client
    .from("notes")
    .select(
      "note_id, bot_name, cn_status, helpful_count, somewhat_helpful_count, not_helpful_count, view_count, submitted_at",
    )
    .order("submitted_at", { ascending: true });

  console.log("=== All notes with bot_name and status ===");
  console.log("Total notes:", notes?.length);

  // Group by bot_name
  const byBot: Record<
    string,
    { total: number; helpful: number; somewhat: number; not_helpful: number; no_status: number; views: number }
  > = {};
  for (const note of notes || []) {
    const bot = note.bot_name || "unknown";
    if (!byBot[bot]) byBot[bot] = { total: 0, helpful: 0, somewhat: 0, not_helpful: 0, no_status: 0, views: 0 };
    byBot[bot].total++;

    if (note.cn_status === "CURRENTLY_RATED_HELPFUL") byBot[bot].helpful++;
    else if (note.cn_status === "NEEDS_MORE_RATINGS") byBot[bot].no_status++;
    else if (!note.cn_status) byBot[bot].no_status++;

    byBot[bot].views += note.view_count || 0;
  }

  console.log("\n=== By Bot ===");
  console.log(JSON.stringify(byBot, null, 2));

  // Get snapshots with view counts over time
  const { data: snapshots } = await client
    .from("scraped_notewriter_snapshots")
    .select("note_id, view_count, cn_status, created_at")
    .not("view_count", "is", null)
    .order("created_at", { ascending: true });

  console.log("\n=== Snapshots with views ===");
  console.log("Total snapshots with views:", snapshots?.length);
  if (snapshots && snapshots.length > 0) {
    console.log("Sample:", snapshots.slice(0, 5));
  }

  // Get all snapshots to see structure
  const { data: allSnapshots } = await client
    .from("scraped_notewriter_snapshots")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);

  console.log("\n=== Recent snapshots (all fields) ===");
  console.log(JSON.stringify(allSnapshots, null, 2));

  // note_status_history was dropped in migration 004 — replaced by scraped_notewriter_snapshots
}

main().catch(console.error);
