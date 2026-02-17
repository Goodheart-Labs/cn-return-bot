import "dotenv/config";
import { getSupabaseClient } from "../src/api/supabaseClient";
const s = getSupabaseClient();

// Note IDs from the screenshots
const noteIds = [
  "2023106166310723661",  // SpaceX - Helpful, 2.2K views
  "2023005420453814275",  // Curling - Not helpful
  "2022793588434755930",  // Japan Muslim cemeteries - Helpful, 189.4K views
  "2022598863769551290",  // Russia $1B - Helpful, 93.1K views
  "2022540972324724740",  // In de Gloria - Helpful, 14.1K views
];

// Check notes table (bot submissions)
const { data: inNotes } = await s.from("notes").select("note_id, bot_name, submitted_at").in("note_id", noteIds);
console.log("In notes table:", inNotes?.length || 0);
for (const n of inNotes || []) {
  console.log(`  ${n.note_id} | ${n.bot_name} | ${n.submitted_at}`);
}

// Check scraped_notewriter_notes
const { data: inScraped } = await s.from("scraped_notewriter_notes").select("note_id, first_seen_at").in("note_id", noteIds);
console.log("\nIn scraped_notewriter_notes:", inScraped?.length || 0);
for (const n of inScraped || []) {
  console.log(`  ${n.note_id} | first_seen: ${n.first_seen_at}`);
}

// Check pipeline_runs for these tweets
const { data: inPipeline } = await s.from("pipeline_runs")
  .select("note_id, bot_id, outcome, created_at")
  .in("note_id", noteIds);
console.log("\nIn pipeline_runs:", inPipeline?.length || 0);
for (const r of inPipeline || []) {
  console.log(`  ${r.note_id} | ${r.bot_id} | ${r.outcome} | ${r.created_at}`);
}

// Check most recent notes in notes table
const { data: recentNotes } = await s.from("notes")
  .select("note_id, bot_name, submitted_at")
  .order("submitted_at", { ascending: false })
  .limit(10);
console.log("\nMost recent 10 notes in notes table:");
for (const n of recentNotes || []) {
  console.log(`  ${n.submitted_at} | ${n.bot_name} | ${n.note_id}`);
}
