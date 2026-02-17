import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

async function main() {
  // Get all snapshots with helpful status
  const { data: snaps } = await s.from("scraped_notewriter_snapshots")
    .select("note_id, cn_status, view_count, scraped_at")
    .in("cn_status", ["CURRENTLY_RATED_HELPFUL", "SHOWN_ON_X", "Currently rated helpful"])
    .order("scraped_at", { ascending: false });

  // Get latest per note with highest view count
  const noteData = new Map<string, { cn_status: string; view_count: number }>();
  for (const snap of snaps || []) {
    const existing = noteData.get(snap.note_id);
    if (!existing) {
      noteData.set(snap.note_id, {
        cn_status: snap.cn_status,
        view_count: snap.view_count || 0
      });
    } else if ((snap.view_count || 0) > existing.view_count) {
      noteData.set(snap.note_id, {
        cn_status: snap.cn_status,
        view_count: snap.view_count || 0
      });
    }
  }

  // Get tweet_ids from scraped_notewriter_notes
  const noteIds = [...noteData.keys()];
  const { data: scrapedNotes } = await s.from("scraped_notewriter_notes")
    .select("note_id, tweet_id")
    .in("note_id", noteIds);

  const tweetIdMap = new Map<string, string>();
  for (const n of scrapedNotes || []) {
    tweetIdMap.set(n.note_id, n.tweet_id);
  }

  // Build final list
  const helpful: Array<{
    note_id: string;
    tweet_id: string;
    status: string;
    views: number;
  }> = [];

  for (const [noteId, data] of noteData) {
    const tweetId = tweetIdMap.get(noteId);
    if (tweetId) {
      helpful.push({
        note_id: noteId,
        tweet_id: tweetId,
        status: data.cn_status,
        views: data.view_count
      });
    }
  }

  // Sort by views descending
  helpful.sort((a, b) => b.views - a.views);

  // Calculate total
  const totalViews = helpful.reduce((sum, n) => sum + n.views, 0);

  console.log("=== HELPFUL NOTES ===");
  console.log(`Total views: ${totalViews.toLocaleString()}`);
  console.log(`Total helpful notes: ${helpful.length}`);
  console.log("");

  for (const n of helpful) {
    const url = n.tweet_id.startsWith("unavailable_")
      ? `[tweet unavailable]`
      : `https://x.com/i/status/${n.tweet_id}`;
    const views = n.views.toLocaleString().padStart(10);
    console.log(`${views} views | ${n.status.padEnd(25)} | ${url}`);
  }
}

main().catch(console.error);
