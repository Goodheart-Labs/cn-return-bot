import { getSupabaseClient } from "../api/supabaseClient";

async function main() {
  const client = getSupabaseClient();

  // Get all unique statuses from snapshots
  const { data: snapshots } = await client
    .from("scraped_notewriter_snapshots")
    .select("cn_status");

  const allStatuses = new Set<string>();
  for (const s of snapshots || []) {
    if (s.cn_status) allStatuses.add(s.cn_status);
  }

  console.log("All unique statuses in snapshots:");
  for (const status of [...allStatuses].sort()) {
    console.log(`  "${status}"`);
  }

  // Also check the notes table
  const { data: notes } = await client
    .from("notes")
    .select("cn_status");

  const noteStatuses = new Set<string>();
  for (const n of notes || []) {
    if (n.cn_status) noteStatuses.add(n.cn_status);
  }

  console.log("\nAll unique statuses in notes table:");
  for (const status of [...noteStatuses].sort()) {
    console.log(`  "${status}"`);
  }

  // Check canonical_note_information too
  const { data: scrapedNotes } = await client
    .from("canonical_note_information")
    .select("cn_status");

  const scrapedStatuses = new Set<string>();
  for (const n of scrapedNotes || []) {
    if (n.cn_status) scrapedStatuses.add(n.cn_status);
  }

  console.log("\nAll unique statuses in canonical_note_information:");
  for (const status of [...scrapedStatuses].sort()) {
    console.log(`  "${status}"`);
  }
}

main().catch(console.error);
