import { getSupabaseClient } from "../src/api/supabaseClient";

const supabase = getSupabaseClient();

async function fetchAll(table: string, select: string) {
  const all: any[] = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(offset, offset + limit - 1);
    if (error) { console.error(`Error fetching ${table}:`, error.message); return []; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < limit) break;
    offset += limit;
  }
  return all;
}

async function main() {
  // First, discover the columns
  const { data: sample, error } = await supabase
    .from("scraped_notewriter_notes")
    .select("*")
    .limit(1);
  if (error) { console.error("Schema error:", error.message); return; }
  if (sample && sample.length > 0) {
    console.log("Columns:", Object.keys(sample[0]).join(", "));
  }

  const { data: snapSample } = await supabase
    .from("scraped_notewriter_snapshots")
    .select("*")
    .limit(1);
  if (snapSample && snapSample.length > 0) {
    console.log("Snapshot columns:", Object.keys(snapSample[0]).join(", "));
  }

  console.log(`\n=== SCRAPED NOTES AUDIT ===`);
  const allNotes = await fetchAll("scraped_notewriter_notes", "*");
  console.log(`Total notes: ${allNotes.length}`);

  if (allNotes.length === 0) return;

  // Placeholder note_ids
  const placeholders = allNotes.filter(n => n.note_id?.startsWith("tweet_") || n.note_id?.startsWith("unavailable_"));
  console.log(`\nPlaceholder note_ids: ${placeholders.length}`);
  if (placeholders.length > 0) {
    console.log(`  tweet_*: ${placeholders.filter((p: any) => p.note_id.startsWith("tweet_")).length}`);
    console.log(`  unavailable_*: ${placeholders.filter((p: any) => p.note_id.startsWith("unavailable_")).length}`);
  }

  // Determine status column name
  const statusKey = allNotes[0].cn_status !== undefined ? "cn_status" : 
                    allNotes[0].status !== undefined ? "status" : null;

  // Duplicate tweet_ids  
  const tweetIdCounts = new Map<string, any[]>();
  for (const n of allNotes) {
    if (!n.tweet_id || n.tweet_id.startsWith("unavailable_")) continue;
    const existing = tweetIdCounts.get(n.tweet_id) || [];
    existing.push(n);
    tweetIdCounts.set(n.tweet_id, existing);
  }
  const dupTweetIds = [...tweetIdCounts.entries()].filter(([, notes]) => notes.length > 1);
  console.log(`\nDuplicate tweet_ids (multiple notes for same tweet): ${dupTweetIds.length}`);
  for (const [tweetId, notes] of dupTweetIds.slice(0, 10)) {
    console.log(`  tweet ${tweetId}:`);
    for (const n of notes) {
      console.log(`    note=${n.note_id} status=${statusKey ? n[statusKey] : 'N/A'}`);
    }
  }

  // Status distribution
  if (statusKey) {
    const statusCounts = new Map<string, number>();
    for (const n of allNotes) {
      const s = n[statusKey] || "NULL";
      statusCounts.set(s, (statusCounts.get(s) || 0) + 1);
    }
    console.log(`\nStatus distribution:`);
    for (const [status, count] of [...statusCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${status}: ${count}`);
    }
  }

  // Empty note_text
  const textKey = allNotes[0].note_text !== undefined ? "note_text" : "text";
  const emptyText = allNotes.filter(n => !n[textKey] || n[textKey].trim() === "");
  console.log(`\nNotes with empty/null text: ${emptyText.length}`);

  // Short text
  const shortText = allNotes.filter(n => n[textKey] && n[textKey].trim().length > 0 && n[textKey].trim().length < 20);
  console.log(`Notes with very short text (<20 chars): ${shortText.length}`);
  for (const n of shortText.slice(0, 5)) {
    console.log(`  ${n.note_id}: "${n[textKey]}"`);
  }

  // Duplicate note_text
  const textCounts = new Map<string, string[]>();
  for (const n of allNotes) {
    if (!n[textKey] || n[textKey].trim().length < 10) continue;
    const text = n[textKey].trim();
    const existing = textCounts.get(text) || [];
    existing.push(n.note_id);
    textCounts.set(text, existing);
  }
  const dupTexts = [...textCounts.entries()].filter(([, ids]) => ids.length > 1);
  console.log(`\nDuplicate note texts: ${dupTexts.length}`);
  for (const [text, ids] of dupTexts.slice(0, 10)) {
    console.log(`  "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}" → ${ids.length} notes`);
    for (const id of ids) console.log(`    ${id}`);
  }

  // Snapshots
  console.log(`\n=== SNAPSHOTS ===`);
  const snapshots = await fetchAll("scraped_notewriter_snapshots", "*");
  console.log(`Total snapshots: ${snapshots.length}`);

  const viewSnapshots = snapshots.filter(s => s.view_count && s.view_count > 0);
  console.log(`Snapshots with view counts: ${viewSnapshots.length}`);
  const uniqueViewNotes = new Set(viewSnapshots.map(s => s.note_id));
  console.log(`Unique notes with view data: ${uniqueViewNotes.size}`);
  if (viewSnapshots.length > 0) {
    const views = viewSnapshots.map(s => s.view_count).sort((a: number, b: number) => b - a);
    console.log(`Highest: ${views[0]?.toLocaleString()}, Median: ${views[Math.floor(views.length / 2)]?.toLocaleString()}, Lowest: ${views[views.length - 1]?.toLocaleString()}`);
  }

  // Orphan snapshots
  const noteIds = new Set(allNotes.map(n => n.note_id));
  const orphanSnapshots = snapshots.filter(s => !noteIds.has(s.note_id));
  const orphanNoteIds = new Set(orphanSnapshots.map(s => s.note_id));
  console.log(`\nOrphan snapshots (note not in notes table): ${orphanSnapshots.length} (${orphanNoteIds.size} unique)`);
  if (orphanNoteIds.size > 0 && orphanNoteIds.size <= 10) {
    for (const id of orphanNoteIds) console.log(`  ${id}`);
  }
}

main().catch(console.error);
