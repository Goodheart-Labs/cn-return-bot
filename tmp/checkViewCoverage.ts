import "dotenv/config";
import { getSupabaseClient } from "../src/api/supabaseClient";
const s = getSupabaseClient();

// Get all bot-submitted note_ids
const { data: notes } = await s.from("notes").select("note_id");
const botNoteIds = new Set((notes || []).map(n => n.note_id));
console.log(`Bot-submitted notes: ${botNoteIds.size}`);

// Get latest 1000 snapshots (what the old query returned)
const { data: limited } = await s.from("scraped_notewriter_snapshots")
  .select("note_id, view_count")
  .order("scraped_at", { ascending: false })
  .limit(1000);

const coveredByLimited = new Set((limited || []).map(s => s.note_id));
let matchedLimited = 0;
for (const id of botNoteIds) {
  if (coveredByLimited.has(id)) matchedLimited++;
}
console.log(`Covered by top 1000 snapshots: ${matchedLimited}/${botNoteIds.size}`);

// Now get ALL snapshots (paginated)
const allSnaps: any[] = [];
let offset = 0;
while (true) {
  const { data: page } = await s.from("scraped_notewriter_snapshots")
    .select("note_id, view_count")
    .order("scraped_at", { ascending: false })
    .range(offset, offset + 999);
  if (!page || page.length === 0) break;
  allSnaps.push(...page);
  if (page.length < 1000) break;
  offset += 1000;
}
const coveredByAll = new Set(allSnaps.map(s => s.note_id));
let matchedAll = 0;
for (const id of botNoteIds) {
  if (coveredByAll.has(id)) matchedAll++;
}
console.log(`Covered by ALL snapshots: ${matchedAll}/${botNoteIds.size}`);

// View count comparison
const latestViewByLimited = new Map<string, number>();
for (const snap of limited || []) {
  if (!latestViewByLimited.has(snap.note_id)) {
    latestViewByLimited.set(snap.note_id, snap.view_count || 0);
  }
}
const latestViewByAll = new Map<string, number>();
for (const snap of allSnaps) {
  if (!latestViewByAll.has(snap.note_id)) {
    latestViewByAll.set(snap.note_id, snap.view_count || 0);
  }
}

let totalViewsLimited = 0, totalViewsAll = 0;
for (const id of botNoteIds) {
  totalViewsLimited += latestViewByLimited.get(id) || 0;
  totalViewsAll += latestViewByAll.get(id) || 0;
}
console.log(`Total views (top 1000 snapshots): ${totalViewsLimited.toLocaleString()}`);
console.log(`Total views (ALL snapshots): ${totalViewsAll.toLocaleString()}`);
console.log(`Difference: ${(totalViewsAll - totalViewsLimited).toLocaleString()}`);
