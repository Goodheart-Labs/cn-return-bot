import { SupabaseLogger } from "../api/supabaseClient";

async function calculateTotalViews() {
  const supabase = new SupabaseLogger();

  // Get the latest snapshot for each note with view counts
  const { data: snapshots, error } = await supabase["client"]
    .from("scraped_notewriter_snapshots")
    .select("note_id, view_count, scraped_at")
    .not("view_count", "is", null)
    .order("scraped_at", { ascending: false });

  if (error) {
    console.error("Error fetching snapshots:", error);
    process.exit(1);
  }

  // Get unique note_ids with their latest view count
  const latestViews = new Map<string, number>();
  for (const snap of snapshots || []) {
    if (!latestViews.has(snap.note_id)) {
      latestViews.set(snap.note_id, snap.view_count);
    }
  }

  const totalViews = Array.from(latestViews.values()).reduce((sum, views) => sum + views, 0);
  const notesWithViews = latestViews.size;

  console.log(`Total views across all notes: ${totalViews.toLocaleString()}`);
  console.log(`Notes with view counts: ${notesWithViews}`);
  console.log(`Average views per note: ${Math.round(totalViews / notesWithViews).toLocaleString()}`);

  // Show top 10 most viewed notes
  const sortedNotes = Array.from(latestViews.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  console.log("\nTop 10 most viewed notes:");
  for (const [note_id, views] of sortedNotes) {
    console.log(`  ${note_id}: ${views.toLocaleString()} views`);
  }

  // Get bot breakdown if possible
  const { data: notes } = await supabase["client"]
    .from("notes")
    .select("note_id, bot_name")
    .in(
      "note_id",
      Array.from(latestViews.keys())
    );

  const viewsByBot = new Map<string, number>();
  for (const note of notes || []) {
    if (note.bot_name && latestViews.has(note.note_id)) {
      const views = latestViews.get(note.note_id)!;
      viewsByBot.set(note.bot_name, (viewsByBot.get(note.bot_name) || 0) + views);
    }
  }

  if (viewsByBot.size > 0) {
    console.log("\nViews by bot:");
    for (const [bot, views] of Array.from(viewsByBot.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${bot}: ${views.toLocaleString()} views`);
    }
  }
}

calculateTotalViews().catch(console.error);
