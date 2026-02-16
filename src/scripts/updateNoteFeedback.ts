import "dotenv/config";
import { SupabaseLogger, Note } from "../api/supabaseClient";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";

const CN_DATA_BASE_URL = "https://ton.twimg.com/birdwatch-public-data";
const DATA_DIR = "./cn-data";
const PARTITION_CACHE_FILE = "./cn-data/partition-cache.json";

interface PartitionCache {
  notePartitions: Record<string, string>;
  partitionCounts: Record<string, number>;
  lastUpdated: string;
}

interface CNStatusRow {
  noteId: string;
  currentStatus: string;
  createdAtMillis: string;
  coreNoteIntercept: string;
  coreNoteFactor1: string;
}

interface CNNoteRow {
  noteId: string;
  tweetId: string;
  createdAtMillis: string;
}

function loadPartitionCache(): PartitionCache {
  if (existsSync(PARTITION_CACHE_FILE)) {
    try {
      return JSON.parse(readFileSync(PARTITION_CACHE_FILE, "utf-8"));
    } catch {
      console.log("[updateNoteFeedback] Failed to load partition cache, starting fresh");
    }
  }
  return {
    notePartitions: {},
    partitionCounts: {},
    lastUpdated: new Date().toISOString(),
  };
}

function savePartitionCache(cache: PartitionCache): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  cache.lastUpdated = new Date().toISOString();
  writeFileSync(PARTITION_CACHE_FILE, JSON.stringify(cache, null, 2));
}

function getPrimaryPartition(cache: PartitionCache): string | null {
  const entries = Object.entries(cache.partitionCounts);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const [partition, count] = entries[0]!;
  if (count >= 5) {
    console.log(`[updateNoteFeedback] Primary partition: ${partition} (${count} notes)`);
    return partition;
  }
  return null;
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  console.log(`[updateNoteFeedback] Downloading ${url}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  const buffer = await response.arrayBuffer();
  writeFileSync(outputPath, Buffer.from(buffer));
  console.log(`[updateNoteFeedback] Downloaded to ${outputPath}`);
}

function formatDateForUrl(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

/**
 * Parse TSV file line by line using simple string splitting
 * (avoids Bun readline issues)
 */
function parseTsvFile<T>(
  filePath: string,
  columnsNeeded: string[],
  filterFn?: (row: Record<string, string>) => boolean
): T[] {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  if (lines.length === 0) return [];

  const headers = lines[0]!.split("\t");
  const columnIndices: Record<string, number> = {};
  for (const col of columnsNeeded) {
    columnIndices[col] = headers.indexOf(col);
  }

  const results: T[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;

    const values = line.split("\t");
    const row: Record<string, string> = {};

    for (const col of columnsNeeded) {
      const idx = columnIndices[col] ?? -1;
      row[col] = idx >= 0 ? values[idx] || "" : "";
    }

    if (!filterFn || filterFn(row)) {
      results.push(row as T);
    }
  }

  return results;
}

/**
 * Download a CN data file, trying multiple days backwards
 */
async function downloadCNFile(
  fileType: "noteStatusHistory" | "notes",
  partition: string = "00000"
): Promise<{ path: string; dateStr: string } | null> {
  const zipFileName = `${fileType}-${partition}.zip`;
  const tsvFileName = `${fileType}-${partition}.tsv`;
  const zipPath = `${DATA_DIR}/${zipFileName}`;
  const tsvPath = `${DATA_DIR}/${tsvFileName}`;

  const maxDaysBack = 7;

  for (let daysBack = 0; daysBack < maxDaysBack; daysBack++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - daysBack);
    const dateStr = formatDateForUrl(date);
    const url = `${CN_DATA_BASE_URL}/${dateStr}/${fileType}/${zipFileName}`;

    try {
      await downloadFile(url, zipPath);
      console.log(`[updateNoteFeedback] Successfully downloaded ${fileType} from ${dateStr}`);

      console.log(`[updateNoteFeedback] Extracting ${zipFileName}...`);
      execSync(`unzip -o "${zipPath}" -d "${DATA_DIR}"`, { stdio: "pipe" });
      unlinkSync(zipPath);

      return { path: tsvPath, dateStr };
    } catch (err) {
      if (daysBack < maxDaysBack - 1) {
        console.log(`[updateNoteFeedback] No ${fileType} data for ${dateStr}, trying earlier...`);
      }
    }
  }

  console.error(`[updateNoteFeedback] Could not find ${fileType} data for partition ${partition}`);
  return null;
}

async function main() {
  console.log("[updateNoteFeedback] Starting feedback update...");

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("[updateNoteFeedback] Missing Supabase credentials");
    process.exit(1);
  }

  const supabase = new SupabaseLogger();

  // Get our notes and the tweets they're on
  const ourNotes = await supabase.getNotesNeedingFeedback(1);

  if (ourNotes.length === 0) {
    console.log("[updateNoteFeedback] No notes need updating");
    process.exit(0);
  }

  console.log(`[updateNoteFeedback] ${ourNotes.length} notes need feedback updates`);

  const ourNoteIds = new Set(ourNotes.map((n) => n.note_id));
  const ourTweetIds = new Set(ourNotes.map((n) => n.tweet_id));

  // Load partition cache
  const partitionCache = loadPartitionCache();
  const primaryPartition = getPrimaryPartition(partitionCache) || "00000";

  // Download noteStatusHistory (has currentStatus)
  const statusResult = await downloadCNFile("noteStatusHistory", primaryPartition);
  if (!statusResult) {
    console.error("[updateNoteFeedback] Failed to download noteStatusHistory");
    process.exit(1);
  }

  // Download notes file (has tweetId mapping)
  const notesResult = await downloadCNFile("notes", primaryPartition);
  if (!notesResult) {
    console.error("[updateNoteFeedback] Failed to download notes file");
    process.exit(1);
  }

  const snapshotDate = statusResult.dateStr.replace(/\//g, "-"); // "2026/01/19" -> "2026-01-19"

  // Parse noteStatusHistory to get status for all notes
  console.log("[updateNoteFeedback] Parsing noteStatusHistory...");
  const allStatusRows = parseTsvFile<CNStatusRow>(
    statusResult.path,
    ["noteId", "currentStatus", "createdAtMillis", "coreNoteIntercept", "coreNoteFactor1"]
  );
  console.log(`[updateNoteFeedback] Found ${allStatusRows.length} total status rows`);

  // Build noteId -> status map
  const statusByNoteId = new Map<string, CNStatusRow>();
  for (const row of allStatusRows) {
    statusByNoteId.set(row.noteId, row);
  }

  // Parse notes file to get noteId -> tweetId mapping
  console.log("[updateNoteFeedback] Parsing notes file...");
  const allNoteRows = parseTsvFile<CNNoteRow>(
    notesResult.path,
    ["noteId", "tweetId", "createdAtMillis"]
  );
  console.log(`[updateNoteFeedback] Found ${allNoteRows.length} total note rows`);

  // Build tweetId -> noteIds map (for finding competing notes)
  const notesByTweetId = new Map<string, CNNoteRow[]>();
  const noteIdToTweetId = new Map<string, string>();

  for (const row of allNoteRows) {
    noteIdToTweetId.set(row.noteId, row.tweetId);

    if (!notesByTweetId.has(row.tweetId)) {
      notesByTweetId.set(row.tweetId, []);
    }
    notesByTweetId.get(row.tweetId)!.push(row);
  }

  // Find all notes to snapshot:
  // 1. Our notes
  // 2. Any other notes on the same tweets (competing notes)
  const notesToSnapshot: Array<{
    noteId: string;
    tweetId: string;
    currentStatus: string;
    isOurs: boolean;
    createdAtMillis: string;
    coreNoteIntercept?: number;
    coreNoteFactor1?: number;
  }> = [];

  // Add our notes
  for (const ourNote of ourNotes) {
    const status = statusByNoteId.get(ourNote.note_id);
    const tweetId = noteIdToTweetId.get(ourNote.note_id) || ourNote.tweet_id;

    notesToSnapshot.push({
      noteId: ourNote.note_id,
      tweetId,
      currentStatus: status?.currentStatus || "",
      isOurs: true,
      createdAtMillis: status?.createdAtMillis || "",
      coreNoteIntercept: status?.coreNoteIntercept ? parseFloat(status.coreNoteIntercept) : undefined,
      coreNoteFactor1: status?.coreNoteFactor1 ? parseFloat(status.coreNoteFactor1) : undefined,
    });
  }

  // Add competing notes (other notes on same tweets)
  let competingCount = 0;
  for (const tweetId of ourTweetIds) {
    const notesOnTweet = notesByTweetId.get(tweetId) || [];
    for (const noteRow of notesOnTweet) {
      if (ourNoteIds.has(noteRow.noteId)) continue; // Skip our own notes

      const status = statusByNoteId.get(noteRow.noteId);
      notesToSnapshot.push({
        noteId: noteRow.noteId,
        tweetId: noteRow.tweetId,
        currentStatus: status?.currentStatus || "",
        isOurs: false,
        createdAtMillis: noteRow.createdAtMillis,
        coreNoteIntercept: status?.coreNoteIntercept ? parseFloat(status.coreNoteIntercept) : undefined,
        coreNoteFactor1: status?.coreNoteFactor1 ? parseFloat(status.coreNoteFactor1) : undefined,
      });
      competingCount++;
    }
  }

  console.log(`[updateNoteFeedback] Found ${competingCount} competing notes on same tweets`);

  // Save snapshots to public_data_snapshots
  let snapshotCount = 0;
  let updatedCount = 0;
  let newlyHelpfulCount = 0;

  for (const note of notesToSnapshot) {
    try {
      // Insert snapshot
      await supabase.insertPublicDataSnapshot({
        note_id: note.noteId,
        tweet_id: note.tweetId,
        current_status: note.currentStatus,
        is_ours: note.isOurs,
        snapshot_date: snapshotDate,
        created_at_millis: note.createdAtMillis ? parseInt(note.createdAtMillis) : undefined,
        core_note_intercept: note.coreNoteIntercept,
        core_note_factor1: note.coreNoteFactor1,
      });
      snapshotCount++;

      // If it's our note, also update the notes table
      if (note.isOurs && note.currentStatus) {
        const existingNote = ourNotes.find((n) => n.note_id === note.noteId);
        const isNewlyHelpful =
          note.currentStatus === "CURRENTLY_RATED_HELPFUL" &&
          existingNote?.cn_status !== "CURRENTLY_RATED_HELPFUL";

        await supabase.updateNoteFeedback(note.noteId, {
          cn_status: note.currentStatus,
          first_helpful_at: isNewlyHelpful ? new Date().toISOString() : existingNote?.first_helpful_at,
        });

        updatedCount++;
        if (isNewlyHelpful) {
          newlyHelpfulCount++;
          console.log(`[updateNoteFeedback] 🎉 Note ${note.noteId} became HELPFUL!`);
        }
      }
    } catch (err: any) {
      // Ignore duplicate key errors (already have snapshot for this date)
      if (!err.message?.includes("duplicate key")) {
        console.error(`[updateNoteFeedback] Error saving snapshot for ${note.noteId}:`, err.message);
      }
    }
  }

  // Update partition cache
  for (const note of notesToSnapshot.filter(n => n.isOurs)) {
    partitionCache.notePartitions[note.noteId] = primaryPartition;
    partitionCache.partitionCounts[primaryPartition] =
      (partitionCache.partitionCounts[primaryPartition] || 0) + 1;
  }
  savePartitionCache(partitionCache);

  console.log(`[updateNoteFeedback] Created ${snapshotCount} snapshots`);
  console.log(`[updateNoteFeedback] Updated ${updatedCount} of our notes`);
  console.log(`[updateNoteFeedback] ${newlyHelpfulCount} notes newly helpful`);

  // Log any helpful competing notes
  const helpfulCompeting = notesToSnapshot.filter(
    (n) => !n.isOurs && n.currentStatus === "CURRENTLY_RATED_HELPFUL"
  );
  if (helpfulCompeting.length > 0) {
    console.log(`[updateNoteFeedback] ⚠️  ${helpfulCompeting.length} competing notes are HELPFUL:`);
    for (const note of helpfulCompeting) {
      console.log(`   - Note ${note.noteId} on tweet ${note.tweetId}`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[updateNoteFeedback] Fatal error:", err);
  process.exit(1);
});
