import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const rows: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client.from(table).select(select).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

// --- Fetch all data ---
const notes = await fetchAll<{ note_id: string; tweet_id: string; created_at: string }>(
  "scraped_notewriter_notes", "note_id, tweet_id, created_at"
);
const snaps = await fetchAll<{ note_id: string; cn_status: string; view_count: number; scraped_at: string }>(
  "scraped_notewriter_snapshots", "note_id, cn_status, view_count, scraped_at"
);

// --- scraped_notewriter_notes ---
console.log("=== scraped_notewriter_notes ===");
console.log("Total rows:", notes.length);

const noteIdCounts = new Map<string, number>();
for (const n of notes) noteIdCounts.set(n.note_id, (noteIdCounts.get(n.note_id) || 0) + 1);
const dupNoteIds = [...noteIdCounts.entries()].filter(([_, c]) => c > 1);
console.log("Duplicate note_ids:", dupNoteIds.length);
for (const [id, count] of dupNoteIds.slice(0, 5)) console.log("  ", id, "x" + count);

const placeholders = notes.filter(n => n.note_id.startsWith("tweet_"));
console.log("Placeholder note_ids (tweet_*):", placeholders.length);

const nullTweet = notes.filter(n => !n.tweet_id);
console.log("Null/empty tweet_id:", nullTweet.length);

// Duplicate tweet_ids (same tweet noted multiple times)
const tweetToNoteIds = new Map<string, string[]>();
for (const n of notes) {
  if (!n.tweet_id) continue;
  if (!tweetToNoteIds.has(n.tweet_id)) tweetToNoteIds.set(n.tweet_id, []);
  tweetToNoteIds.get(n.tweet_id)!.push(n.note_id);
}
const tweetsMulti = [...tweetToNoteIds.entries()].filter(([_, ids]) => ids.length > 1);
console.log("Tweets with multiple notes:", tweetsMulti.length);
for (const [tid, ids] of tweetsMulti.slice(0, 5)) console.log("  tweet", tid, "->", ids);

// --- scraped_notewriter_snapshots ---
console.log("\n=== scraped_notewriter_snapshots ===");
console.log("Total rows:", snaps.length);

const snapNoteIds = new Set(snaps.map(s => s.note_id));
const notesNoteIds = new Set(notes.map(n => n.note_id));

const orphanSnaps = [...snapNoteIds].filter(id => !notesNoteIds.has(id));
const notesNoSnaps = [...notesNoteIds].filter(id => !snapNoteIds.has(id));
console.log("Unique note_ids in snapshots:", snapNoteIds.size);
console.log("Unique note_ids in notes:", notesNoteIds.size);
console.log("Orphan snapshots (no parent note):", orphanSnaps.length);
if (orphanSnaps.length > 0) console.log("  Examples:", orphanSnaps.slice(0, 5));
console.log("Notes with no snapshots:", notesNoSnaps.length);
if (notesNoSnaps.length > 0) console.log("  Examples:", notesNoSnaps.slice(0, 5));

const nullStatus = snaps.filter(s => !s.cn_status);
console.log("Null/empty cn_status snapshots:", nullStatus.length);

const zeroViews = snaps.filter(s => !s.view_count || s.view_count === 0);
console.log("Zero/null view_count snapshots:", zeroViews.length, "of", snaps.length);

// --- Status distribution (latest snapshot per note) ---
// Sort by scraped_at DESC so first occurrence per note_id is latest
const sortedSnaps = [...snaps].sort((a, b) => b.scraped_at.localeCompare(a.scraped_at));
const latestByNote = new Map<string, { status: string; views: number }>();
for (const s of sortedSnaps) {
  if (!latestByNote.has(s.note_id)) {
    latestByNote.set(s.note_id, { status: s.cn_status || "", views: s.view_count || 0 });
  }
}

const statusDist = new Map<string, number>();
for (const { status } of latestByNote.values()) {
  statusDist.set(status, (statusDist.get(status) || 0) + 1);
}
console.log("\n=== Status distribution (latest snapshot per note) ===");
for (const [status, count] of [...statusDist.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(" ", status || "(empty)", ":", count);
}

// --- Inconsistent casing check ---
const normalizedStatus = new Map<string, Set<string>>();
for (const { status } of latestByNote.values()) {
  const norm = status.toUpperCase().replace(/\s+/g, "_");
  if (!normalizedStatus.has(norm)) normalizedStatus.set(norm, new Set());
  normalizedStatus.get(norm)!.add(status);
}
const inconsistent = [...normalizedStatus.entries()].filter(([_, variants]) => variants.size > 1);
if (inconsistent.length > 0) {
  console.log("\n=== Inconsistent status casing ===");
  for (const [norm, variants] of inconsistent) {
    console.log(" ", norm, "->", [...variants]);
  }
}

// --- Summary totals (what the report would show) ---
let totalViews = 0, totalHelpful = 0, totalNotHelpful = 0, totalNeedsMore = 0, totalUnknown = 0;
for (const { views, status } of latestByNote.values()) {
  totalViews += views;
  const s = status.toUpperCase().replace(/\s+/g, "_");
  if (s === "CURRENTLY_RATED_HELPFUL" || s === "SHOWN_ON_X") totalHelpful++;
  else if (s === "CURRENTLY_RATED_NOT_HELPFUL" || s === "NOT_SHOWN_ON_X") totalNotHelpful++;
  else if (s === "NEEDS_MORE_RATINGS") totalNeedsMore++;
  else totalUnknown++;
}
const knownTotal = totalHelpful + totalNotHelpful + totalNeedsMore;
console.log("\n=== Report summary (what cards would show) ===");
console.log("Total notes:", latestByNote.size);
console.log("Helpful:", totalHelpful);
console.log("Not helpful:", totalNotHelpful);
console.log("Needs more ratings:", totalNeedsMore);
console.log("Unknown/other:", totalUnknown);
console.log("Helpful rate:", knownTotal > 0 ? ((totalHelpful / knownTotal) * 100).toFixed(1) + "%" : "N/A");
console.log("Total views:", totalViews.toLocaleString());
