import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function main() {
  // Get all note_ids from notes table
  const { data: trackedNotes } = await supabase
    .from("notes")
    .select("note_id, tweet_id");

  const trackedNoteIds = new Set(trackedNotes?.map((n) => n.note_id) || []);
  const trackedTweetIds = new Set(trackedNotes?.map((n) => n.tweet_id) || []);

  // Get all scraped notewriter notes
  const { data: scrapedNotes } = await supabase
    .from("scraped_notewriter_notes")
    .select("note_id, tweet_id, note_text, source_url, created_at");

  // Find untracked ones (not in notes table)
  const untracked =
    scrapedNotes?.filter((n) => {
      return !trackedNoteIds.has(n.note_id) && !trackedTweetIds.has(n.tweet_id);
    }) || [];

  console.log("Total scraped:", scrapedNotes?.length || 0);
  console.log("Tracked notes:", trackedNotes?.length || 0);
  console.log("Untracked scraped notes:", untracked.length);

  // Get latest snapshots for untracked notes
  const { data: snapshots } = await supabase
    .from("scraped_notewriter_snapshots")
    .select(
      "note_id, cn_status, view_count, helpful_count, somewhat_helpful_count, not_helpful_count, scraped_at"
    )
    .in(
      "note_id",
      untracked.map((n) => n.note_id)
    )
    .order("scraped_at", { ascending: false });

  // Build map of latest snapshot per note
  const latestSnapshot: Record<string, NonNullable<typeof snapshots>[number]> = {};
  if (snapshots) {
    snapshots.forEach((s) => {
      if (!latestSnapshot[s.note_id]) {
        latestSnapshot[s.note_id] = s;
      }
    });
  }

  console.log("\n=== UNTRACKED NOTES WITH STATUS ===\n");

  const enriched = untracked.map((note) => ({
    ...note,
    snapshot: latestSnapshot[note.note_id] || {},
  }));

  // Show first 30
  enriched.slice(0, 30).forEach((n, i) => {
    const s = n.snapshot as any;
    console.log(`${i + 1}. tweet: ${n.tweet_id}`);
    console.log(`   note_id: ${n.note_id}`);
    console.log(
      `   status: ${s.cn_status || "unknown"} | views: ${s.view_count || "?"} | helpful: ${s.helpful_count || 0}/${s.somewhat_helpful_count || 0}/${s.not_helpful_count || 0}`
    );
    const text = (n.note_text || "").substring(0, 100);
    console.log(`   text: ${text}...`);
    console.log("");
  });

  // Summary by status
  const byStatus: Record<string, number> = {};
  enriched.forEach((n) => {
    const status = (n.snapshot as any).cn_status || "unknown";
    byStatus[status] = (byStatus[status] || 0) + 1;
  });

  console.log("\n=== BY STATUS ===");
  Object.entries(byStatus).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
    console.log(`${status}: ${count}`);
  });
}

main().catch(console.error);
