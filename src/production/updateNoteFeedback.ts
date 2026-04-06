import "dotenv/config";
import { getSupabaseClient } from "../api/supabaseClient";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";

/**
 * Daily job: update canonical_note_information + competing_notes from CN public data dumps.
 *
 * Uses our author participant ID to find ALL our notes in the public data (not just
 * the ~604 in the `notes` table). Downloads notes-00000 + noteStatusHistory-00000
 * (all our notes are in partition 00000), extracts status, classification, and
 * competing note data, then upserts into Supabase.
 *
 * Also creates public_data_snapshots for historical tracking.
 */

const CN_DATA_BASE_URL = "https://ton.twimg.com/birdwatch-public-data";
const DATA_DIR = "./cn-data";
const OUR_AUTHOR = "813EB394B10809EBA8D09BCFA8E2E1C25A2DA0085186867F9E9C00696951C447";
const PAGE_SIZE = 1000;

const useLocal = process.argv.includes("--local");
if (useLocal) {
  console.log("[updateFeedback] Using LOCAL Supabase");
  process.env.SUPABASE_URL = process.env.LOCAL_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_KEY = process.env.LOCAL_SUPABASE_SERVICE_KEY;
}
const client = getSupabaseClient();

async function fetchAll<T>(buildQuery: () => any): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

function formatDateForUrl(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  console.log(`[updateFeedback] Downloading ${url}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  const buffer = await response.arrayBuffer();
  writeFileSync(outputPath, Buffer.from(buffer));
}

const PARTITIONS: Record<string, string[]> = {
  notes: ["00000", "00001"],
  noteStatusHistory: ["00000"],
};

async function downloadCNFile(
  fileType: "noteStatusHistory" | "notes"
): Promise<{ paths: string[]; dateStr: string } | null> {
  // Try recent dates until we find one that has data
  for (let daysBack = 0; daysBack < 7; daysBack++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - daysBack);
    const dateStr = formatDateForUrl(date);

    // Try to download the first partition to determine the date
    const testUrl = `${CN_DATA_BASE_URL}/${dateStr}/${fileType}/${fileType}-00000.zip`;
    const testZip = `${DATA_DIR}/${fileType}-00000.zip`;
    const testTsv = `${DATA_DIR}/${fileType}-00000.tsv`;

    try {
      await downloadFile(testUrl, testZip);
      execSync(`unzip -o "${testZip}" -d "${DATA_DIR}"`, { stdio: "pipe" });
      unlinkSync(testZip);

      const paths = [testTsv];

      // Download remaining partitions (best effort)
      for (const partition of (PARTITIONS[fileType] ?? []).slice(1)) {
        const zipName = `${fileType}-${partition}.zip`;
        const tsvName = `${fileType}-${partition}.tsv`;
        const zipPath = `${DATA_DIR}/${zipName}`;
        const tsvPath = `${DATA_DIR}/${tsvName}`;
        const url = `${CN_DATA_BASE_URL}/${dateStr}/${fileType}/${zipName}`;

        try {
          await downloadFile(url, zipPath);
          execSync(`unzip -o "${zipPath}" -d "${DATA_DIR}"`, { stdio: "pipe" });
          unlinkSync(zipPath);
          paths.push(tsvPath);
        } catch {
          console.log(`[updateFeedback] Partition ${partition} not available for ${fileType}`);
        }
      }

      console.log(`[updateFeedback] Got ${fileType} from ${dateStr} (${paths.length} partition(s))`);
      return { paths, dateStr };
    } catch {
      if (daysBack < 6) {
        console.log(`[updateFeedback] No ${fileType} for ${dateStr}, trying earlier...`);
      }
    }
  }

  console.error(`[updateFeedback] Could not find ${fileType} data`);
  return null;
}

function readTsvLines(paths: string[]): { header: string; lines: string[] } {
  let header = "";
  const lines: string[] = [];
  for (const p of paths) {
    const content = readFileSync(p, "utf-8");
    const fileLines = content.split("\n");
    if (!header && fileLines[0]) header = fileLines[0];
    // Skip header for all files, add data lines
    for (let i = 1; i < fileLines.length; i++) {
      if (fileLines[i]) lines.push(fileLines[i]!);
    }
  }
  return { header, lines };
}

async function main() {
  console.log("[updateFeedback] Starting public data feedback update...");

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("[updateFeedback] Missing Supabase credentials");
    process.exit(1);
  }

  // ===== 1. Download public data files =====
  const notesResult = await downloadCNFile("notes");
  if (!notesResult) process.exit(1);

  const statusResult = await downloadCNFile("noteStatusHistory");
  if (!statusResult) process.exit(1);

  const snapshotDate = statusResult.dateStr.replace(/\//g, "-");

  // ===== 2. Parse notes file — find our notes + competing notes =====
  console.log("[updateFeedback] Parsing notes file...");
  const { header: notesHeader, lines: noteDataLines } = readTsvLines(notesResult.paths);
  const nh = notesHeader.split("\t");
  const nIdx = {
    noteId: nh.indexOf("noteId"),
    author: nh.indexOf("noteAuthorParticipantId"),
    tweetId: nh.indexOf("tweetId"),
    createdAtMillis: nh.indexOf("createdAtMillis"),
    classification: nh.indexOf("classification"),
    summary: nh.indexOf("summary"),
  };

  // First pass: find our notes and their tweet IDs
  const ourNotes = new Map<string, {
    tweetId: string;
    createdAtMillis: string;
    classification: string;
    summary: string;
  }>();

  for (const line of noteDataLines) {
    const vals = line.split("\t");
    if (vals[nIdx.author] !== OUR_AUTHOR) continue;
    ourNotes.set(vals[nIdx.noteId]!, {
      tweetId: vals[nIdx.tweetId]!,
      createdAtMillis: vals[nIdx.createdAtMillis]!,
      classification: vals[nIdx.classification]!,
      summary: vals[nIdx.summary]!,
    });
  }
  console.log(`[updateFeedback] Found ${ourNotes.size} of our notes in public data`);

  const ourTweetIds = new Set([...ourNotes.values()].map(n => n.tweetId));
  const ourNoteIds = new Set(ourNotes.keys());

  // Second pass: find competing notes (other notes on same tweets)
  const competingNotes: Array<{
    noteId: string;
    tweetId: string;
    ourNoteId: string;
    authorId: string;
    summary: string;
    classification: string;
    createdAtMillis: string;
  }> = [];

  for (const line of noteDataLines) {
    const vals = line.split("\t");
    const tweetId = vals[nIdx.tweetId]!;
    if (!ourTweetIds.has(tweetId)) continue;
    if (vals[nIdx.author] === OUR_AUTHOR) continue;

    // Find which of our notes is on this tweet
    const ourNoteId = [...ourNotes.entries()].find(([_, n]) => n.tweetId === tweetId)?.[0];
    if (!ourNoteId) continue;

    competingNotes.push({
      noteId: vals[nIdx.noteId]!,
      tweetId,
      ourNoteId,
      authorId: vals[nIdx.author] || "",
      summary: vals[nIdx.summary] || "",
      classification: vals[nIdx.classification] || "",
      createdAtMillis: vals[nIdx.createdAtMillis] || "",
    });
  }
  console.log(`[updateFeedback] Found ${competingNotes.length} competing notes`);

  // ===== 2.5. Third pass: find notes on rejected tweet_ids (missed opportunities) =====
  console.log("[updateFeedback] Checking for missed opportunities...");
  const rejectedRuns = await fetchAll<{ id: string; tweet_id: string; outcome_reason: string | null }>(
    () => client.from("pipeline_runs").select("id, tweet_id, outcome_reason").eq("outcome", "rejected")
  );
  const rejectedTweetIds = new Map<string, { runId: string; outcomeReason: string | null }>();
  for (const run of rejectedRuns) {
    // Keep the latest run per tweet (overwrite is fine, they're fetched in insertion order)
    rejectedTweetIds.set(run.tweet_id, { runId: run.id, outcomeReason: run.outcome_reason });
  }
  // Exclude tweets where we also submitted a note
  for (const n of ourNotes.values()) {
    rejectedTweetIds.delete(n.tweetId);
  }
  console.log(`[updateFeedback] ${rejectedTweetIds.size} tweets with rejected pipeline runs (no submission)`);

  const missedOpportunityNotes: Array<{
    noteId: string;
    tweetId: string;
    pipelineRunId: string;
    authorId: string;
    summary: string;
    classification: string;
    createdAtMillis: string;
  }> = [];

  for (const line of noteDataLines) {
    const vals = line.split("\t");
    const tweetId = vals[nIdx.tweetId]!;
    if (!rejectedTweetIds.has(tweetId)) continue;
    if (vals[nIdx.author] === OUR_AUTHOR) continue;

    const run = rejectedTweetIds.get(tweetId)!;
    missedOpportunityNotes.push({
      noteId: vals[nIdx.noteId]!,
      tweetId,
      pipelineRunId: run.runId,
      authorId: vals[nIdx.author] || "",
      summary: vals[nIdx.summary] || "",
      classification: vals[nIdx.classification] || "",
      createdAtMillis: vals[nIdx.createdAtMillis] || "",
    });
  }
  console.log(`[updateFeedback] Found ${missedOpportunityNotes.length} notes on rejected tweets`);

  // ===== 3. Parse noteStatusHistory =====
  console.log("[updateFeedback] Parsing noteStatusHistory...");
  const { header: statusHeader, lines: statusDataLines } = readTsvLines(statusResult.paths);
  const sh = statusHeader.split("\t");
  const sIdx = {
    noteId: sh.indexOf("noteId"),
    currentStatus: sh.indexOf("currentStatus"),
    currentCoreStatus: sh.indexOf("currentCoreStatus"),
    currentExpansionStatus: sh.indexOf("currentExpansionStatus"),
    currentGroupStatus: sh.indexOf("currentGroupStatus"),
    currentDecidedBy: sh.indexOf("currentDecidedBy"),
    currentModelingGroup: sh.indexOf("currentModelingGroup"),
    firstNonNMRStatus: sh.indexOf("firstNonNMRStatus"),
    mostRecentNonNMRStatus: sh.indexOf("mostRecentNonNMRStatus"),
    lockedStatus: sh.indexOf("lockedStatus"),
    timestampMillisOfCurrentStatus: sh.indexOf("timestampMillisOfCurrentStatus"),
    timestampMillisOfFirstNonNMRStatus: sh.indexOf("timestampMillisOfFirstNonNMRStatus"),
    timestampMillisOfStatusLock: sh.indexOf("timestampMillisOfStatusLock"),
  };

  // Build sets of note IDs we care about
  const competingNoteIds = new Set(competingNotes.map(n => n.noteId));
  const missedNoteIds = new Set(missedOpportunityNotes.map(n => n.noteId));
  const allRelevantIds = new Set([...ourNoteIds, ...competingNoteIds, ...missedNoteIds]);

  const statusMap = new Map<string, {
    currentStatus: string;
    currentCoreStatus: string;
    currentExpansionStatus: string;
    currentGroupStatus: string;
    currentDecidedBy: string;
    currentModelingGroup: string;
    firstNonNMRStatus: string;
    mostRecentNonNMRStatus: string;
    lockedStatus: string;
    statusUpdatedAt: string | null;
    firstNonNmrAt: string | null;
    statusLockedAt: string | null;
  }>();

  for (const line of statusDataLines) {
    const firstTab = line.indexOf("\t");
    const noteId = line.slice(0, firstTab);
    if (!allRelevantIds.has(noteId)) continue;

    const vals = line.split("\t");
    statusMap.set(noteId, {
      currentStatus: vals[sIdx.currentStatus] || "",
      currentCoreStatus: vals[sIdx.currentCoreStatus] || "",
      currentExpansionStatus: vals[sIdx.currentExpansionStatus] || "",
      currentGroupStatus: vals[sIdx.currentGroupStatus] || "",
      currentDecidedBy: vals[sIdx.currentDecidedBy] || "",
      currentModelingGroup: vals[sIdx.currentModelingGroup] || "",
      firstNonNMRStatus: vals[sIdx.firstNonNMRStatus] || "",
      mostRecentNonNMRStatus: vals[sIdx.mostRecentNonNMRStatus] || "",
      lockedStatus: vals[sIdx.lockedStatus] || "",
      statusUpdatedAt: vals[sIdx.timestampMillisOfCurrentStatus]
        ? new Date(parseInt(vals[sIdx.timestampMillisOfCurrentStatus]!)).toISOString() : null,
      firstNonNmrAt: vals[sIdx.timestampMillisOfFirstNonNMRStatus]
        ? new Date(parseInt(vals[sIdx.timestampMillisOfFirstNonNMRStatus]!)).toISOString() : null,
      statusLockedAt: vals[sIdx.timestampMillisOfStatusLock]
        ? new Date(parseInt(vals[sIdx.timestampMillisOfStatusLock]!)).toISOString() : null,
    });
  }
  console.log(`[updateFeedback] Found ${statusMap.size} status records for relevant notes`);

  // ===== 4. Get existing canonical data =====
  console.log("[updateFeedback] Fetching existing canonical data...");
  const existing = await fetchAll<{ note_id: string; cn_status: string | null }>(
    () => client.from("canonical_note_information").select("note_id, cn_status")
  );
  const existingIds = new Set(existing.map(n => n.note_id));
  const existingStatusMap = new Map(existing.map(n => [n.note_id, n.cn_status]));
  console.log(`[updateFeedback] ${existing.length} existing canonical entries`);

  // ===== 5. Upsert our notes into canonical_note_information =====
  // Fetch submitted_at and bot_name from notes table to keep canonical in sync
  const notesEnrichment = await fetchAll<{ note_id: string; submitted_at: string | null; bot_name: string | null }>(
    () => client.from("notes").select("note_id, submitted_at, bot_name")
  );
  const enrichmentMap = new Map(notesEnrichment.map(n => [n.note_id, n]));

  const now = new Date().toISOString();
  let newlyHelpful = 0;

  // Split new vs existing rows into separate batches because PostgREST normalizes
  // all rows in a batch to the same columns — mixing rows with/without first_seen_at
  // causes it to set first_seen_at=NULL on existing rows, violating NOT NULL.
  const newCanonicalRows: Record<string, any>[] = [];
  const existingCanonicalRows: Record<string, any>[] = [];
  for (const [noteId, noteData] of ourNotes) {
    const status = statusMap.get(noteId);

    const wasHelpful = existingStatusMap.get(noteId) === "CURRENTLY_RATED_HELPFUL";
    const isNowHelpful = status?.currentStatus === "CURRENTLY_RATED_HELPFUL";
    if (isNowHelpful && !wasHelpful) newlyHelpful++;

    const row: Record<string, any> = {
      note_id: noteId,
      tweet_id: noteData.tweetId,
      cn_status: status?.currentStatus || "NEEDS_MORE_RATINGS",
      note_text: noteData.summary || null,
      classification: noteData.classification || null,
      current_core_status: status?.currentCoreStatus || null,
      current_expansion_status: status?.currentExpansionStatus || null,
      current_group_status: status?.currentGroupStatus || null,
      current_decided_by: status?.currentDecidedBy || null,
      current_modeling_group: status?.currentModelingGroup || null,
      first_non_nmr_status: status?.firstNonNMRStatus || null,
      most_recent_non_nmr_status: status?.mostRecentNonNMRStatus || null,
      locked_status: status?.lockedStatus || null,
      status_updated_at: status?.statusUpdatedAt || null,
      first_non_nmr_at: status?.firstNonNmrAt || null,
      status_locked_at: status?.statusLockedAt || null,
      public_data_updated_at: now,
      submitted_at: noteData.createdAtMillis
        ? new Date(parseInt(noteData.createdAtMillis)).toISOString()
        : enrichmentMap.get(noteId)?.submitted_at || null,
      bot_name: enrichmentMap.get(noteId)?.bot_name || null,
    };

    if (existingIds.has(noteId)) {
      existingCanonicalRows.push(row);
    } else {
      row.first_seen_at = now;
      newCanonicalRows.push(row);
    }
  }

  let upserted = 0, upsertErrors = 0;
  for (const rows of [newCanonicalRows, existingCanonicalRows]) {
    for (let i = 0; i < rows.length; i += PAGE_SIZE) {
      const batch = rows.slice(i, i + PAGE_SIZE);
      const { error } = await client
        .from("canonical_note_information")
        .upsert(batch, { onConflict: "note_id" });
      if (error) {
        console.error(`[updateFeedback] Error upserting canonical batch: ${error.message}`);
        upsertErrors += batch.length;
      } else {
        upserted += batch.length;
      }
    }
  }

  console.log(`[updateFeedback] Canonical: ${upserted} upserted, ${upsertErrors} errors`);
  if (newlyHelpful > 0) {
    console.log(`[updateFeedback] ${newlyHelpful} notes newly rated HELPFUL!`);
  }

  // ===== 6. Upsert competing notes =====
  console.log("[updateFeedback] Upserting competing notes...");
  const competingRows = competingNotes.map(cn => {
    const status = statusMap.get(cn.noteId);
    return {
      tweet_id: cn.tweetId,
      note_id: cn.noteId,
      our_note_id: cn.ourNoteId,
      author_participant_id: cn.authorId || null,
      note_text: cn.summary || null,
      classification: cn.classification || null,
      current_status: status?.currentStatus || null,
      current_core_status: status?.currentCoreStatus || null,
      current_decided_by: status?.currentDecidedBy || null,
      created_at_millis: cn.createdAtMillis ? parseInt(cn.createdAtMillis) : null,
      last_updated_at: now,
    };
  });

  let competingUpserted = 0, competingErrors = 0;
  for (let i = 0; i < competingRows.length; i += PAGE_SIZE) {
    const batch = competingRows.slice(i, i + PAGE_SIZE);
    const { error } = await client
      .from("competing_notes")
      .upsert(batch, { onConflict: "note_id,our_note_id" });
    if (error) {
      console.error(`[updateFeedback] Error upserting competing batch: ${error.message}`);
      competingErrors += batch.length;
    } else {
      competingUpserted += batch.length;
    }
  }
  console.log(`[updateFeedback] Competing: ${competingUpserted} upserted, ${competingErrors} errors`);

  // ===== 6.5. Replace missed opportunity competing notes (helpful only) =====
  console.log("[updateFeedback] Replacing missed opportunity competing notes...");
  const missedRows = missedOpportunityNotes
    .filter(mn => {
      const status = statusMap.get(mn.noteId);
      return status?.currentCoreStatus === "CURRENTLY_RATED_HELPFUL";
    })
    .map(mn => {
      const status = statusMap.get(mn.noteId)!;
      return {
        tweet_id: mn.tweetId,
        note_id: mn.noteId,
        our_note_id: null,
        pipeline_run_id: mn.pipelineRunId,
        author_participant_id: mn.authorId || null,
        note_text: mn.summary || null,
        classification: mn.classification || null,
        current_status: status.currentStatus || null,
        current_core_status: status.currentCoreStatus || null,
        current_decided_by: status.currentDecidedBy || null,
        created_at_millis: mn.createdAtMillis ? parseInt(mn.createdAtMillis) : null,
        last_updated_at: now,
      };
    });

  await client.from("competing_notes").delete().is("our_note_id", null);
  let missedInserted = 0;
  for (let i = 0; i < missedRows.length; i += PAGE_SIZE) {
    const batch = missedRows.slice(i, i + PAGE_SIZE);
    const { error } = await client
      .from("competing_notes")
      .insert(batch);
    if (error) {
      console.error(`[updateFeedback] Error inserting missed opportunity competing notes: ${error.message}`);
    } else {
      missedInserted += batch.length;
    }
  }
  console.log(`[updateFeedback] Missed opportunity competing notes: ${missedInserted} inserted (helpful only)`);

  // ===== 7. Create public_data_snapshots for historical tracking =====
  console.log("[updateFeedback] Creating public data snapshots...");
  let snapshotCount = 0;

  for (const [noteId, noteData] of ourNotes) {
    const status = statusMap.get(noteId);
    try {
      const { error } = await client
        .from("public_data_snapshots")
        .upsert({
          note_id: noteId,
          tweet_id: noteData.tweetId,
          current_status: status?.currentStatus || "NEEDS_MORE_RATINGS",
          is_ours: true,
          snapshot_date: snapshotDate,
          created_at_millis: noteData.createdAtMillis ? parseInt(noteData.createdAtMillis) : undefined,
        }, { onConflict: "note_id,snapshot_date", ignoreDuplicates: false });
      if (!error) snapshotCount++;
    } catch {
      // Ignore duplicates
    }
  }

  // Also snapshot helpful competing notes
  for (const cn of competingNotes) {
    const status = statusMap.get(cn.noteId);
    if (status?.currentStatus !== "CURRENTLY_RATED_HELPFUL") continue;
    try {
      const { error } = await client
        .from("public_data_snapshots")
        .upsert({
          note_id: cn.noteId,
          tweet_id: cn.tweetId,
          current_status: status.currentStatus,
          is_ours: false,
          snapshot_date: snapshotDate,
          created_at_millis: cn.createdAtMillis ? parseInt(cn.createdAtMillis) : undefined,
          note_text: cn.summary || null,
        }, { onConflict: "note_id,snapshot_date", ignoreDuplicates: false });
      if (!error) snapshotCount++;
    } catch {
      // Ignore duplicates
    }
  }

  console.log(`[updateFeedback] Created/updated ${snapshotCount} snapshots`);

  // ===== 8. Also update the `notes` table for notes that exist there =====
  // (Keeps backwards compat with any code still reading from `notes.cn_status`)
  const notesTableIds = await fetchAll<{ note_id: string }>(
    () => client.from("notes").select("note_id")
  );
  const notesTableIdSet = new Set(notesTableIds.map(n => n.note_id));
  let notesTableUpdated = 0;

  for (const [noteId, _] of ourNotes) {
    if (!notesTableIdSet.has(noteId)) continue;
    const status = statusMap.get(noteId);
    const resolvedStatus = status?.currentStatus || "NEEDS_MORE_RATINGS";

    const { error } = await client
      .from("notes")
      .update({
        cn_status: resolvedStatus,
        last_checked_at: now,
      })
      .eq("note_id", noteId);

    if (!error) notesTableUpdated++;
  }

  console.log(`[updateFeedback] Updated ${notesTableUpdated} notes in notes table`);

  // ===== 9. Clean up downloaded files =====
  try {
    for (const p of [...notesResult.paths, ...statusResult.paths]) {
      if (existsSync(p)) unlinkSync(p);
    }
    console.log("[updateFeedback] Cleaned up data files");
  } catch {
    console.log("[updateFeedback] Note: could not clean up some data files");
  }

  // ===== Summary =====
  const helpfulCompeting = competingNotes.filter(
    cn => statusMap.get(cn.noteId)?.currentStatus === "CURRENTLY_RATED_HELPFUL"
  );
  if (helpfulCompeting.length > 0) {
    console.log(`[updateFeedback] ${helpfulCompeting.length} competing notes are HELPFUL`);
  }

  console.log(`\n=== DONE ===`);
  console.log(`Our notes: ${ourNotes.size} found, ${upserted} upserted, ${upsertErrors} errors`);
  console.log(`Competing notes: ${competingNotes.length} found, ${competingUpserted} upserted`);
  console.log(`Missed opportunity competing notes: ${missedInserted} inserted`);
  console.log(`Snapshots: ${snapshotCount}`);
  console.log(`Notes table: ${notesTableUpdated} synced`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[updateFeedback] Fatal error:", err);
  process.exit(1);
});
