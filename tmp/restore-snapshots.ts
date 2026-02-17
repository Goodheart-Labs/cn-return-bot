import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// Parse CSV
const csv = readFileSync("Supabase Snippet Notewriter Snapshot Metrics Lookup.csv", "utf-8");
const lines = csv.trim().split("\n").slice(1); // skip header

const snapshots = lines.map(line => {
  const [note_id, cn_status, view_count, helpful_count, somewhat_helpful_count, not_helpful_count, scraped_at] = line.split(",");
  return {
    note_id,
    cn_status: cn_status || null,
    view_count: view_count === "null" || !view_count ? null : parseInt(view_count),
    helpful_count: helpful_count === "null" || !helpful_count ? null : parseInt(helpful_count),
    somewhat_helpful_count: somewhat_helpful_count === "null" || !somewhat_helpful_count ? null : parseInt(somewhat_helpful_count),
    not_helpful_count: not_helpful_count === "null" || !not_helpful_count ? null : parseInt(not_helpful_count),
    scraped_at,
  };
});

console.log(`Parsed ${snapshots.length} snapshots from CSV`);

// Check which note_ids already exist in scraped_notewriter_notes
const uniqueNoteIds = [...new Set(snapshots.map(s => s.note_id))];
console.log(`Unique note_ids: ${uniqueNoteIds.length}`);

const existing = new Set<string>();
for (let i = 0; i < uniqueNoteIds.length; i += 50) {
  const batch = uniqueNoteIds.slice(i, i + 50);
  const { data, error } = await client
    .from("scraped_notewriter_notes")
    .select("note_id")
    .in("note_id", batch);
  if (error) throw error;
  for (const row of data || []) existing.add(row.note_id);
}

const missing = uniqueNoteIds.filter((id): id is string => !!id && !existing.has(id));
console.log(`Already exist in scraped_notewriter_notes: ${existing.size}`);
console.log(`Need to re-create parent rows: ${missing.length}`);

// Re-create minimal parent rows for missing note_ids
// We don't have the original tweet_id/note_text, so use placeholder
if (missing.length > 0) {
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50).map(note_id => ({
      note_id,
      tweet_id: `unknown_restored_${note_id}`,
    }));
    const { error } = await client
      .from("scraped_notewriter_notes")
      .insert(batch);
    if (error) {
      console.error("Error inserting parent rows:", error);
      throw error;
    }
  }
  console.log(`Created ${missing.length} parent rows`);
}

// Now insert the snapshots
let inserted = 0;
let errors = 0;
for (let i = 0; i < snapshots.length; i += 50) {
  const batch = snapshots.slice(i, i + 50);
  const { error } = await client
    .from("scraped_notewriter_snapshots")
    .insert(batch);
  if (error) {
    console.error(`Error inserting batch ${Math.floor(i/50)+1}:`, error);
    errors += batch.length;
  } else {
    inserted += batch.length;
  }
}

console.log(`\nDone. Inserted ${inserted} snapshots, ${errors} errors.`);
