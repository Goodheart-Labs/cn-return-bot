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

const snaps = await fetchAll<{ note_id: string; cn_status: string; view_count: number; scraped_at: string }>(
  "scraped_notewriter_snapshots", "note_id, cn_status, view_count, scraped_at"
);

// Get latest snapshot per note
const sortedSnaps = [...snaps].sort((a, b) => b.scraped_at.localeCompare(a.scraped_at));
const latestByNote = new Map<string, { status: string; views: number; scraped_at: string }>();
for (const s of sortedSnaps) {
  if (!latestByNote.has(s.note_id)) {
    latestByNote.set(s.note_id, { status: s.cn_status || "", views: s.view_count || 0, scraped_at: s.scraped_at });
  }
}

// Find UNKNOWN status notes
const unknowns: { note_id: string; status: string; views: number; scraped_at: string }[] = [];
for (const [note_id, data] of latestByNote) {
  const s = data.status.toUpperCase().replace(/\s+/g, "_");
  if (s === "UNKNOWN" || s === "") {
    unknowns.push({ note_id, ...data });
  }
}

console.log(`Total notes with latest snapshot: ${latestByNote.size}`);
console.log(`UNKNOWN/empty status: ${unknowns.length}\n`);

// Check how many snapshots each unknown note has, and if any have a non-UNKNOWN status
const allSnapsByNote = new Map<string, typeof snaps>();
for (const s of snaps) {
  if (!allSnapsByNote.has(s.note_id)) allSnapsByNote.set(s.note_id, []);
  allSnapsByNote.get(s.note_id)!.push(s);
}

let hasOlderGoodStatus = 0;
let onlyUnknown = 0;
let singleSnapshot = 0;

for (const u of unknowns) {
  const allSnaps = allSnapsByNote.get(u.note_id) || [];
  const statuses = allSnaps.map(s => s.cn_status).filter(s => s && s !== "UNKNOWN");

  if (allSnaps.length === 1) singleSnapshot++;
  if (statuses.length > 0) hasOlderGoodStatus++;
  else onlyUnknown++;
}

console.log("Breakdown:");
console.log(`  Single snapshot only: ${singleSnapshot}`);
console.log(`  Has older non-UNKNOWN snapshot: ${hasOlderGoodStatus}`);
console.log(`  ALL snapshots are UNKNOWN: ${onlyUnknown}`);

// Show a few examples
console.log("\n=== Examples with older good status ===");
let shown = 0;
for (const u of unknowns) {
  const allSnaps = (allSnapsByNote.get(u.note_id) || []).sort((a, b) => b.scraped_at.localeCompare(a.scraped_at));
  const statuses = allSnaps.map(s => `${s.cn_status} (${s.scraped_at.slice(0, 10)})`);
  const hasGood = allSnaps.some(s => s.cn_status && s.cn_status !== "UNKNOWN");
  if (hasGood && shown < 5) {
    console.log(`  ${u.note_id}: ${statuses.join(" → ")}`);
    shown++;
  }
}

console.log("\n=== Examples with only UNKNOWN ===");
shown = 0;
for (const u of unknowns) {
  const allSnaps = (allSnapsByNote.get(u.note_id) || []).sort((a, b) => b.scraped_at.localeCompare(a.scraped_at));
  const hasGood = allSnaps.some(s => s.cn_status && s.cn_status !== "UNKNOWN");
  if (!hasGood && shown < 5) {
    console.log(`  ${u.note_id}: ${allSnaps.length} snapshots, all UNKNOWN, views=${u.views}`);
    shown++;
  }
}

// When were the UNKNOWN snapshots created?
const unknownDates = new Map<string, number>();
for (const u of unknowns) {
  const allSnaps = allSnapsByNote.get(u.note_id) || [];
  for (const s of allSnaps) {
    const date = s.scraped_at.slice(0, 10);
    unknownDates.set(date, (unknownDates.get(date) || 0) + 1);
  }
}
console.log("\n=== UNKNOWN snapshots by scrape date ===");
for (const [date, count] of [...unknownDates.entries()].sort()) {
  console.log(`  ${date}: ${count}`);
}
