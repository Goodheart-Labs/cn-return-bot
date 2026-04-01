import { getSupabaseClient } from "../../api/supabaseClient";

// Extract timestamp from Twitter/X Snowflake ID
function getDateFromSnowflakeId(id: string): Date {
  const snowflakeId = BigInt(id);
  // Twitter epoch is 1288834974657 (Nov 4, 2010)
  const timestamp = Number((snowflakeId >> 22n) + 1288834974657n);
  return new Date(timestamp);
}

async function main() {
  const client = getSupabaseClient();

  // Get all snapshots with view counts
  const { data: snapshots } = await client
    .from("scraped_notewriter_snapshots")
    .select("note_id, view_count, scraped_at")
    .not("view_count", "is", null)
    .order("scraped_at", { ascending: false });

  console.log("Snapshots with views:", snapshots?.length);

  // Build map of note_id -> latest view_count
  const latestViews: Record<string, number> = {};
  for (const s of snapshots || []) {
    if (!latestViews[s.note_id] && s.view_count) {
      latestViews[s.note_id] = s.view_count;
    }
  }

  console.log("Unique notes with views:", Object.keys(latestViews).length);

  // Test snowflake parsing
  const testId = "2012678261562576959";
  console.log(`\nTest: ID ${testId} -> ${getDateFromSnowflakeId(testId).toISOString()}`);

  // Also get notes directly from canonical_note_information with view_count
  const { data: notesWithViews } = await client
    .from("canonical_note_information")
    .select("note_id, view_count")
    .not("view_count", "is", null);
  console.log("\ncanonical_note_information with views:", notesWithViews?.length);

  // Add these to latestViews if not already present
  for (const n of notesWithViews || []) {
    if (!latestViews[n.note_id] && n.view_count) {
      latestViews[n.note_id] = n.view_count;
    }
  }
  console.log("Combined unique notes with views:", Object.keys(latestViews).length);

  // Aggregate views by note creation date (derived from snowflake ID)
  const viewsByDate: Record<string, { views: number; noteCount: number }> = {};

  for (const [noteId, views] of Object.entries(latestViews)) {
    // Skip placeholder IDs like "tweet_XXXXX"
    if (noteId.startsWith("tweet_")) continue;

    try {
      const noteDate = getDateFromSnowflakeId(noteId);
      const date = noteDate.toISOString().split("T")[0]!;
      if (!viewsByDate[date]) {
        viewsByDate[date] = { views: 0, noteCount: 0 };
      }
      viewsByDate[date]!.views += views;
      viewsByDate[date]!.noteCount++;
    } catch (e) {
      console.log(`Failed to parse note_id: ${noteId}`);
    }
  }

  const sorted = Object.entries(viewsByDate).sort(([a], [b]) => a.localeCompare(b));
  console.log("\nViews by note creation date:");
  for (const [date, data] of sorted) {
    console.log(`  ${date}: ${data.views.toLocaleString()} views (${data.noteCount} notes)`);
  }

  console.log("\nTotal views:", sorted.reduce((sum, [, d]) => sum + d.views, 0).toLocaleString());
  console.log("Date range:", sorted[0]?.[0], "to", sorted[sorted.length - 1]?.[0]);
}

main().catch(console.error);
