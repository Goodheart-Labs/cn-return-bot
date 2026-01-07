import "dotenv/config";
import { SupabaseLogger, Note } from "../api/supabaseClient";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { pipeline } from "stream/promises";
import { createGunzip } from "zlib";
import { Readable } from "stream";

const CN_DATA_BASE_URL = "https://ton.twimg.com/birdwatch-public-data";
const DATA_DIR = "./cn-data";
const PARTITION_CACHE_FILE = "./cn-data/partition-cache.json";

interface PartitionCache {
  // Map of note_id -> partition file where it was found
  notePartitions: Record<string, string>;
  // Count of notes found in each partition (to identify primary partition)
  partitionCounts: Record<string, number>;
  lastUpdated: string;
}

interface CNNoteRow {
  noteId: string;
  tweetId: string;
  currentStatus: string;
  createdAtMillis: string;
  // Rating counts - column positions may vary, we'll parse what we need
}

/**
 * Load or initialize partition cache
 */
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

/**
 * Save partition cache
 */
function savePartitionCache(cache: PartitionCache): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  cache.lastUpdated = new Date().toISOString();
  writeFileSync(PARTITION_CACHE_FILE, JSON.stringify(cache, null, 2));
}

/**
 * Get the most common partition for our notes
 */
function getPrimaryPartition(cache: PartitionCache): string | null {
  const entries = Object.entries(cache.partitionCounts);
  if (entries.length === 0) return null;

  entries.sort((a, b) => b[1] - a[1]);
  const [partition, count] = entries[0];

  // Only use primary partition if we have enough data
  if (count >= 5) {
    console.log(`[updateNoteFeedback] Primary partition: ${partition} (${count} notes)`);
    return partition;
  }
  return null;
}

/**
 * Download a file from URL to local path
 */
async function downloadFile(url: string, outputPath: string): Promise<void> {
  console.log(`[updateNoteFeedback] Downloading ${url}...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const fileStream = createWriteStream(outputPath);
  await pipeline(Readable.fromWeb(response.body as any), fileStream);

  console.log(`[updateNoteFeedback] Downloaded to ${outputPath}`);
}

/**
 * Parse TSV file and find matching notes
 */
async function parseNotesFile(
  filePath: string,
  noteIdsToFind: Set<string>
): Promise<Map<string, CNNoteRow>> {
  const results = new Map<string, CNNoteRow>();

  // Handle both .tsv and .tsv.gz files
  let inputStream: NodeJS.ReadableStream;
  if (filePath.endsWith(".gz")) {
    inputStream = createReadStream(filePath).pipe(createGunzip());
  } else {
    inputStream = createReadStream(filePath);
  }

  const rl = createInterface({
    input: inputStream,
    crlfDelay: Infinity,
  });

  let headers: string[] = [];
  let lineNum = 0;

  for await (const line of rl) {
    lineNum++;

    if (lineNum === 1) {
      headers = line.split("\t");
      continue;
    }

    const values = line.split("\t");
    const noteId = values[headers.indexOf("noteId")];

    if (noteIdsToFind.has(noteId)) {
      results.set(noteId, {
        noteId,
        tweetId: values[headers.indexOf("tweetId")] || "",
        currentStatus: values[headers.indexOf("currentStatus")] || "",
        createdAtMillis: values[headers.indexOf("createdAtMillis")] || "",
      });

      // Early exit if we found all notes
      if (results.size === noteIdsToFind.size) {
        break;
      }
    }
  }

  console.log(`[updateNoteFeedback] Found ${results.size}/${noteIdsToFind.size} notes in ${filePath}`);
  return results;
}

/**
 * Get today's date string for CN data URL
 */
function getTodayDateString(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

/**
 * Try to download notes file, trying today first then yesterday
 */
async function downloadNotesFile(partition: string = "00000"): Promise<string> {
  const fileName = `notes-${partition}.tsv`;
  const outputPath = `${DATA_DIR}/${fileName}`;

  // Try today first
  const todayDate = getTodayDateString();
  const todayUrl = `${CN_DATA_BASE_URL}/${todayDate}/notes/${fileName}`;

  try {
    await downloadFile(todayUrl, outputPath);
    return outputPath;
  } catch (err) {
    console.log(`[updateNoteFeedback] Today's file not available, trying yesterday...`);
  }

  // Try yesterday
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayDate = `${yesterday.getUTCFullYear()}/${String(yesterday.getUTCMonth() + 1).padStart(2, "0")}/${String(yesterday.getUTCDate()).padStart(2, "0")}`;
  const yesterdayUrl = `${CN_DATA_BASE_URL}/${yesterdayDate}/notes/${fileName}`;

  await downloadFile(yesterdayUrl, outputPath);
  return outputPath;
}

/**
 * Main function to update note feedback
 */
async function main() {
  console.log("[updateNoteFeedback] Starting feedback update...");

  // Initialize Supabase
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("[updateNoteFeedback] Missing Supabase credentials");
    process.exit(1);
  }

  const supabase = new SupabaseLogger();

  // Get notes that need feedback updates
  const notesNeedingUpdate = await supabase.getNotesNeedingFeedback(1); // Stale after 1 day

  if (notesNeedingUpdate.length === 0) {
    console.log("[updateNoteFeedback] No notes need updating");
    process.exit(0);
  }

  console.log(`[updateNoteFeedback] ${notesNeedingUpdate.length} notes need feedback updates`);

  const noteIdsToFind = new Set(notesNeedingUpdate.map((n) => n.note_id));

  // Load partition cache
  const partitionCache = loadPartitionCache();

  // Determine which partitions to check
  const partitionsToCheck: string[] = [];

  // First, check if we have a known primary partition
  const primaryPartition = getPrimaryPartition(partitionCache);
  if (primaryPartition) {
    partitionsToCheck.push(primaryPartition);
  }

  // Also check any partitions we know contain our notes
  const knownPartitions = new Set<string>();
  for (const noteId of noteIdsToFind) {
    const partition = partitionCache.notePartitions[noteId];
    if (partition && !partitionsToCheck.includes(partition)) {
      knownPartitions.add(partition);
    }
  }
  partitionsToCheck.push(...knownPartitions);

  // If we don't know any partitions, start with 00000
  if (partitionsToCheck.length === 0) {
    partitionsToCheck.push("00000");
  }

  console.log(`[updateNoteFeedback] Checking partitions: ${partitionsToCheck.join(", ")}`);

  // Download and parse each partition
  const allResults = new Map<string, CNNoteRow>();
  const foundInPartition = new Map<string, string>(); // note_id -> partition

  for (const partition of partitionsToCheck) {
    try {
      const filePath = await downloadNotesFile(partition);
      const results = await parseNotesFile(filePath, noteIdsToFind);

      for (const [noteId, row] of results) {
        allResults.set(noteId, row);
        foundInPartition.set(noteId, partition);
      }

      // Remove found notes from search set
      for (const noteId of results.keys()) {
        noteIdsToFind.delete(noteId);
      }

      if (noteIdsToFind.size === 0) {
        console.log("[updateNoteFeedback] Found all notes!");
        break;
      }
    } catch (err) {
      console.error(`[updateNoteFeedback] Error processing partition ${partition}:`, err);
    }
  }

  // If we still have missing notes and haven't checked all partitions, try more
  if (noteIdsToFind.size > 0 && !partitionsToCheck.includes("00001")) {
    console.log(`[updateNoteFeedback] ${noteIdsToFind.size} notes not found, trying partition 00001...`);
    try {
      const filePath = await downloadNotesFile("00001");
      const results = await parseNotesFile(filePath, noteIdsToFind);

      for (const [noteId, row] of results) {
        allResults.set(noteId, row);
        foundInPartition.set(noteId, "00001");
      }
    } catch (err) {
      console.error("[updateNoteFeedback] Error processing partition 00001:", err);
    }
  }

  // Update partition cache
  for (const [noteId, partition] of foundInPartition) {
    partitionCache.notePartitions[noteId] = partition;
    partitionCache.partitionCounts[partition] = (partitionCache.partitionCounts[partition] || 0) + 1;
  }
  savePartitionCache(partitionCache);

  // Update Supabase with results
  let updatedCount = 0;
  let newlyHelpfulCount = 0;

  for (const [noteId, row] of allResults) {
    const existingNote = notesNeedingUpdate.find((n) => n.note_id === noteId);

    try {
      // Check if this is newly helpful
      const isNewlyHelpful =
        row.currentStatus === "CURRENTLY_RATED_HELPFUL" &&
        existingNote?.cn_status !== "CURRENTLY_RATED_HELPFUL";

      await supabase.updateNoteFeedback(noteId, {
        cn_status: row.currentStatus,
        first_helpful_at: isNewlyHelpful ? new Date().toISOString() : existingNote?.first_helpful_at,
      });

      // Log status history
      await supabase.logStatusHistory(noteId, row.currentStatus);

      updatedCount++;
      if (isNewlyHelpful) {
        newlyHelpfulCount++;
        console.log(`[updateNoteFeedback] 🎉 Note ${noteId} became HELPFUL!`);
      }
    } catch (err) {
      console.error(`[updateNoteFeedback] Failed to update note ${noteId}:`, err);
    }
  }

  console.log(`[updateNoteFeedback] Updated ${updatedCount} notes`);
  console.log(`[updateNoteFeedback] ${newlyHelpfulCount} notes newly helpful`);
  console.log(`[updateNoteFeedback] ${noteIdsToFind.size} notes not found in CN data (may be too new)`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[updateNoteFeedback] Fatal error:", err);
  process.exit(1);
});
