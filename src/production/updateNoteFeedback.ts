import "dotenv/config";
import { getSupabaseClient } from "../api/supabaseClient";
import { fetchNotesWritten, type WrittenNote, type NoteFactorBucketCounts } from "../api/fetchNotesWritten";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";

/**
 * Cron job: refresh `notes`, `competing_notes`, and `public_data_snapshots`
 * from the X API + the CN public data dumps.
 *
 * Stages:
 *   A. Fetch our notes from X API (primary source for status/text)
 *   B. Download public dump (competing & missed-opportunity notes; status fallback)
 *   C. Parse dump (single pass; tweetId→noteId map kills the prior O(n·m) find)
 *   D. Fetch existing DB state (rejected runs + existing note_ids/submitted_at/cn_status)
 *   E. Batched upsert into `notes`
 *   F. Batched upsert into `competing_notes`
 *   G. Replace missed-opportunity rows in `competing_notes` (helpful only)
 *   H. Batched upsert into `public_data_snapshots`
 *   I. Batched upsert into `note_rating_tag_counts` (only for notes with has_access)
 *   J. Cleanup downloaded files
 *
 * ~10 Supabase round-trips per run (was ~1300 — prior versions of stages 7
 * and 8 did per-row writes).
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const CN_DATA_BASE_URL = "https://ton.twimg.com/birdwatch-public-data";
const DATA_DIR = "./cn-data";
const OUR_AUTHOR = "813EB394B10809EBA8D09BCFA8E2E1C25A2DA0085186867F9E9C00696951C447";
const PAGE_SIZE = 1000;
const MAX_DAYS_BACK_FOR_CN_DATA = 7;
const PARTITIONS: Record<string, string[]> = {
  notes: ["00000", "00001"],
  noteStatusHistory: ["00000"],
};
const STATUS_HELPFUL = "CURRENTLY_RATED_HELPFUL";
const STATUS_NMR = "NEEDS_MORE_RATINGS";

const useLocal = process.argv.includes("--local");
if (useLocal) {
  console.log("[updateFeedback] Using LOCAL Supabase");
  process.env.SUPABASE_URL = process.env.LOCAL_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_KEY = process.env.LOCAL_SUPABASE_SERVICE_KEY;
}
const client = getSupabaseClient();

// ─── Types ───────────────────────────────────────────────────────────────────

type OurNoteFromDump = {
  tweetId: string;
  createdAtMillis: string;
  summary: string;
};

type OtherNote = {
  noteId: string;
  tweetId: string;
  authorId: string;
  summary: string;
  classification: string;
  createdAtMillis: string;
};
type CompetingNote = OtherNote & { ourNoteId: string };
type MissedNote = OtherNote & { pipelineRunId: string };

type StatusRecord = { currentStatus: string };

type PublicDumpFiles = {
  notesPaths: string[];
  statusPaths: string[];
  dateStr: string;
};

type ParsedDump = {
  ourNotesFromDump: Map<string, OurNoteFromDump>;
  competing: CompetingNote[];
  missed: MissedNote[];
  statusMap: Map<string, StatusRecord>;
};

type ExistingState = {
  // tweetId → pipelineRunId for the most recent rejected run on that tweet.
  rejectedTweetIds: Map<string, string>;
  existingNoteIds: Set<string>;
  existingSubmittedAt: Map<string, string | null>;
  existingStatuses: Map<string, string | null>;
};

// ─── Generic helpers ─────────────────────────────────────────────────────────

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
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  console.log(`[updateFeedback] Downloading ${url}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
}

function readTsvLines(paths: string[]): { header: string; lines: string[] } {
  let header = "";
  const lines: string[] = [];
  for (const p of paths) {
    const fileLines = readFileSync(p, "utf-8").split("\n");
    if (!header && fileLines[0]) header = fileLines[0];
    for (let i = 1; i < fileLines.length; i++) {
      if (fileLines[i]) lines.push(fileLines[i]!);
    }
  }
  return { header, lines };
}

// ─── Stage B: download public dump ───────────────────────────────────────────

async function downloadCNFile(
  fileType: "noteStatusHistory" | "notes",
): Promise<{ paths: string[]; dateStr: string } | null> {
  for (let daysBack = 0; daysBack < MAX_DAYS_BACK_FOR_CN_DATA; daysBack++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - daysBack);
    const dateStr = formatDateForUrl(date);

    const partitions = PARTITIONS[fileType] ?? ["00000"];
    const firstPartition = partitions[0]!;
    const firstZip = `${DATA_DIR}/${fileType}-${firstPartition}.zip`;
    const firstTsv = `${DATA_DIR}/${fileType}-${firstPartition}.tsv`;
    const firstUrl = `${CN_DATA_BASE_URL}/${dateStr}/${fileType}/${fileType}-${firstPartition}.zip`;

    try {
      await downloadFile(firstUrl, firstZip);
      execSync(`unzip -o "${firstZip}" -d "${DATA_DIR}"`, { stdio: "pipe" });
      unlinkSync(firstZip);

      const paths = [firstTsv];
      for (const partition of partitions.slice(1)) {
        const zipPath = `${DATA_DIR}/${fileType}-${partition}.zip`;
        const tsvPath = `${DATA_DIR}/${fileType}-${partition}.tsv`;
        const url = `${CN_DATA_BASE_URL}/${dateStr}/${fileType}/${fileType}-${partition}.zip`;
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
      if (daysBack < MAX_DAYS_BACK_FOR_CN_DATA - 1) {
        console.log(`[updateFeedback] No ${fileType} for ${dateStr}, trying earlier...`);
      }
    }
  }
  console.error(`[updateFeedback] Could not find ${fileType} data`);
  return null;
}

async function downloadPublicDump(): Promise<PublicDumpFiles | null> {
  const notes = await downloadCNFile("notes");
  if (!notes) return null;
  const status = await downloadCNFile("noteStatusHistory");
  if (!status) return null;
  return { notesPaths: notes.paths, statusPaths: status.paths, dateStr: status.dateStr };
}

// ─── Stage C: parse public dump ──────────────────────────────────────────────

function parsePublicDump(
  files: PublicDumpFiles,
  rejectedTweetIds: Map<string, string>,
): ParsedDump {
  console.log("[updateFeedback] Parsing notes file...");
  const { header: nHeader, lines: nLines } = readTsvLines(files.notesPaths);
  const nh = nHeader.split("\t");
  const nIdx = {
    noteId: nh.indexOf("noteId"),
    author: nh.indexOf("noteAuthorParticipantId"),
    tweetId: nh.indexOf("tweetId"),
    createdAtMillis: nh.indexOf("createdAtMillis"),
    classification: nh.indexOf("classification"),
    summary: nh.indexOf("summary"),
  };

  // Pass 1: identify our notes; build tweetId→noteId map.
  const ourNotesFromDump = new Map<string, OurNoteFromDump>();
  const ourTweetIdToNoteId = new Map<string, string>();
  for (const line of nLines) {
    const vals = line.split("\t");
    if (vals[nIdx.author] !== OUR_AUTHOR) continue;
    const noteId = vals[nIdx.noteId]!;
    const tweetId = vals[nIdx.tweetId]!;
    ourNotesFromDump.set(noteId, {
      tweetId,
      createdAtMillis: vals[nIdx.createdAtMillis]!,
      summary: vals[nIdx.summary]!,
    });
    ourTweetIdToNoteId.set(tweetId, noteId);
  }
  console.log(`[updateFeedback] Found ${ourNotesFromDump.size} of our notes in public data`);

  // Pass 2: competing + missed-opportunity in one walk.
  const competing: CompetingNote[] = [];
  const missed: MissedNote[] = [];
  for (const line of nLines) {
    const vals = line.split("\t");
    const author = vals[nIdx.author];
    if (author === OUR_AUTHOR) continue;
    const tweetId = vals[nIdx.tweetId]!;
    const ourNoteId = ourTweetIdToNoteId.get(tweetId);
    const pipelineRunId = rejectedTweetIds.get(tweetId);

    const base = {
      noteId: vals[nIdx.noteId]!,
      tweetId,
      authorId: author || "",
      summary: vals[nIdx.summary] || "",
      classification: vals[nIdx.classification] || "",
      createdAtMillis: vals[nIdx.createdAtMillis] || "",
    };
    if (ourNoteId) {
      competing.push({ ...base, ourNoteId });
    } else if (pipelineRunId) {
      missed.push({ ...base, pipelineRunId });
    }
  }
  console.log(`[updateFeedback] Found ${competing.length} competing notes`);
  console.log(`[updateFeedback] Found ${missed.length} notes on rejected tweets`);

  console.log("[updateFeedback] Parsing noteStatusHistory...");
  const { header: sHeader, lines: sLines } = readTsvLines(files.statusPaths);
  const sh = sHeader.split("\t");
  const sIdx = {
    noteId: sh.indexOf("noteId"),
    currentStatus: sh.indexOf("currentStatus"),
  };

  const relevantIds = new Set<string>([
    ...ourNotesFromDump.keys(),
    ...competing.map((c) => c.noteId),
    ...missed.map((m) => m.noteId),
  ]);

  const statusMap = new Map<string, StatusRecord>();
  for (const line of sLines) {
    const firstTab = line.indexOf("\t");
    const noteId = line.slice(0, firstTab);
    if (!relevantIds.has(noteId)) continue;
    const vals = line.split("\t");
    statusMap.set(noteId, { currentStatus: vals[sIdx.currentStatus] || "" });
  }
  console.log(`[updateFeedback] Found ${statusMap.size} status records for relevant notes`);

  return { ourNotesFromDump, competing, missed, statusMap };
}

// ─── Stage D: fetch existing DB state ────────────────────────────────────────

async function fetchExistingState(): Promise<ExistingState> {
  console.log("[updateFeedback] Fetching rejected pipeline runs...");
  const rejected = await fetchAll<{ id: string; tweet_id: string }>(() =>
    client.from("pipeline_runs").select("id, tweet_id").eq("outcome", "rejected"),
  );
  const rejectedTweetIds = new Map<string, string>();
  for (const run of rejected) rejectedTweetIds.set(run.tweet_id, run.id);
  console.log(`[updateFeedback] ${rejectedTweetIds.size} tweets with rejected runs`);

  console.log("[updateFeedback] Fetching existing notes state...");
  const existing = await fetchAll<{
    note_id: string;
    cn_status: string | null;
    submitted_at: string | null;
  }>(() => client.from("notes").select("note_id, cn_status, submitted_at"));
  console.log(`[updateFeedback] ${existing.length} existing notes`);

  return {
    rejectedTweetIds,
    existingNoteIds: new Set(existing.map((n) => n.note_id)),
    existingSubmittedAt: new Map(existing.map((n) => [n.note_id, n.submitted_at])),
    existingStatuses: new Map(existing.map((n) => [n.note_id, n.cn_status])),
  };
}

// ─── Stage E: upsert our notes ───────────────────────────────────────────────

async function upsertOurNotes(
  apiNotes: WrittenNote[],
  dumpNotes: Map<string, OurNoteFromDump>,
  statusMap: Map<string, StatusRecord>,
  existing: ExistingState,
  now: string,
): Promise<{ upserted: number; errors: number; newlyHelpful: number }> {
  const apiByNoteId = new Map<string, WrittenNote>();
  for (const n of apiNotes) apiByNoteId.set(n.id, n);

  const allNoteIds = new Set<string>([...apiByNoteId.keys(), ...dumpNotes.keys()]);

  const newRows: Record<string, any>[] = [];
  const existingRows: Record<string, any>[] = [];
  let newlyHelpful = 0;

  for (const noteId of allNoteIds) {
    const api = apiByNoteId.get(noteId);
    const dump = dumpNotes.get(noteId);
    const status = statusMap.get(noteId);

    const tweetId = api?.post_id ?? dump?.tweetId;
    if (!tweetId) continue;

    // API uses lowercase enum values (`currently_rated_helpful`); the rest of
    // the system stores uppercase (from the public dump). Normalize on the way in.
    const apiStatus = api?.status?.toUpperCase();
    const cn_status = apiStatus || status?.currentStatus || STATUS_NMR;

    const wasHelpful = existing.existingStatuses.get(noteId) === STATUS_HELPFUL;
    if (cn_status === STATUS_HELPFUL && !wasHelpful) newlyHelpful++;

    const noteText = api?.info?.text ?? dump?.summary ?? null;
    const submittedAt = dump?.createdAtMillis
      ? new Date(parseInt(dump.createdAtMillis)).toISOString()
      : (existing.existingSubmittedAt.get(noteId) ?? null);

    const row: Record<string, any> = {
      note_id: noteId,
      tweet_id: tweetId,
      cn_status,
      note_text: noteText,
      submitted_at: submittedAt,
    };

    if (existing.existingNoteIds.has(noteId)) {
      existingRows.push(row);
    } else {
      newRows.push({ ...row, first_seen_at: now });
    }
  }

  // Split because PostgREST normalizes columns across a batch — mixing rows
  // with/without first_seen_at would set it to NULL on existing rows
  // (NOT NULL violation).
  let upserted = 0;
  let errors = 0;
  for (const rows of [newRows, existingRows]) {
    for (let i = 0; i < rows.length; i += PAGE_SIZE) {
      const batch = rows.slice(i, i + PAGE_SIZE);
      const { error } = await client.from("notes").upsert(batch, { onConflict: "note_id" });
      if (error) {
        console.error(`[updateFeedback] Error upserting notes batch: ${error.message}`);
        errors += batch.length;
      } else {
        upserted += batch.length;
      }
    }
  }
  console.log(`[updateFeedback] Notes: ${upserted} upserted, ${errors} errors`);
  return { upserted, errors, newlyHelpful };
}

// ─── Stage F: upsert competing notes ─────────────────────────────────────────

async function upsertCompetingNotes(
  competing: CompetingNote[],
  statusMap: Map<string, StatusRecord>,
  now: string,
): Promise<number> {
  const rows = competing.map((cn) => ({
    tweet_id: cn.tweetId,
    note_id: cn.noteId,
    our_note_id: cn.ourNoteId,
    author_participant_id: cn.authorId || null,
    note_text: cn.summary || null,
    classification: cn.classification || null,
    current_status: statusMap.get(cn.noteId)?.currentStatus || null,
    created_at_millis: cn.createdAtMillis ? parseInt(cn.createdAtMillis) : null,
    last_updated_at: now,
  }));

  let upserted = 0;
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const batch = rows.slice(i, i + PAGE_SIZE);
    const { error } = await client
      .from("competing_notes")
      .upsert(batch, { onConflict: "note_id,our_note_id" });
    if (error) {
      console.error(`[updateFeedback] Error upserting competing batch: ${error.message}`);
    } else {
      upserted += batch.length;
    }
  }
  console.log(`[updateFeedback] Competing: ${upserted} upserted`);
  return upserted;
}

// ─── Stage G: replace missed-opportunity notes (helpful only) ────────────────

async function replaceMissedOpportunityNotes(
  missed: MissedNote[],
  statusMap: Map<string, StatusRecord>,
  now: string,
): Promise<number> {
  const rows = missed
    .filter((m) => statusMap.get(m.noteId)?.currentStatus === STATUS_HELPFUL)
    .map((m) => ({
      tweet_id: m.tweetId,
      note_id: m.noteId,
      our_note_id: null,
      pipeline_run_id: m.pipelineRunId,
      author_participant_id: m.authorId || null,
      note_text: m.summary || null,
      classification: m.classification || null,
      current_status: statusMap.get(m.noteId)!.currentStatus,
      created_at_millis: m.createdAtMillis ? parseInt(m.createdAtMillis) : null,
      last_updated_at: now,
    }));

  await client.from("competing_notes").delete().is("our_note_id", null);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const batch = rows.slice(i, i + PAGE_SIZE);
    const { error } = await client.from("competing_notes").insert(batch);
    if (error) {
      console.error(`[updateFeedback] Error inserting missed batch: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }
  console.log(`[updateFeedback] Missed (helpful only): ${inserted} inserted`);
  return inserted;
}

// ─── Stage H: snapshot to public_data_snapshots ──────────────────────────────

async function snapshotPublicData(
  apiNotes: WrittenNote[],
  dumpNotes: Map<string, OurNoteFromDump>,
  competing: CompetingNote[],
  statusMap: Map<string, StatusRecord>,
  snapshotDate: string,
): Promise<number> {
  const rows: Record<string, any>[] = [];

  // Our notes — union of API and dump, deduped by noteId. Dump wins if both
  // have the same note (it has createdAtMillis, the API doesn't).
  const seen = new Set<string>();
  for (const [noteId, d] of dumpNotes) {
    seen.add(noteId);
    rows.push({
      note_id: noteId,
      tweet_id: d.tweetId,
      current_status: statusMap.get(noteId)?.currentStatus || STATUS_NMR,
      is_ours: true,
      snapshot_date: snapshotDate,
      created_at_millis: d.createdAtMillis ? parseInt(d.createdAtMillis) : undefined,
    });
  }
  for (const a of apiNotes) {
    if (seen.has(a.id) || !a.post_id) continue;
    rows.push({
      note_id: a.id,
      tweet_id: a.post_id,
      current_status: a.status?.toUpperCase() || STATUS_NMR,
      is_ours: true,
      snapshot_date: snapshotDate,
    });
  }

  // Competing notes — only snapshot when currently helpful.
  for (const cn of competing) {
    const status = statusMap.get(cn.noteId);
    if (status?.currentStatus !== STATUS_HELPFUL) continue;
    rows.push({
      note_id: cn.noteId,
      tweet_id: cn.tweetId,
      current_status: status.currentStatus,
      is_ours: false,
      snapshot_date: snapshotDate,
      created_at_millis: cn.createdAtMillis ? parseInt(cn.createdAtMillis) : undefined,
    });
  }

  let upserted = 0;
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const batch = rows.slice(i, i + PAGE_SIZE);
    const { error } = await client.from("public_data_snapshots").upsert(batch, {
      onConflict: "note_id,snapshot_date",
      ignoreDuplicates: false,
    });
    if (error) {
      console.error(`[updateFeedback] Error upserting snapshot batch: ${error.message}`);
    } else {
      upserted += batch.length;
    }
  }
  console.log(`[updateFeedback] Snapshots: ${upserted} upserted`);
  return upserted;
}

// ─── Stage I: rating-tag counts ──────────────────────────────────────────────

type RaterBucket = "negative" | "neutral" | "positive";
type RatingTagRow = {
  note_id: string;
  model_name: string;
  tag_name: string;
  count: number;
  rater_bucket: RaterBucket;
  last_updated_at: string;
};

function buildTagRow(
  noteId: string,
  modelName: string,
  bucket: RaterBucket,
  tag: { tag_name: string; tag_count: number } | undefined,
  now: string,
): RatingTagRow | null {
  if (!tag?.tag_name || typeof tag.tag_count !== "number") return null;
  return {
    note_id: noteId,
    model_name: modelName,
    tag_name: tag.tag_name,
    count: tag.tag_count,
    rater_bucket: bucket,
    last_updated_at: now,
  };
}

async function upsertRatingTagCounts(apiNotes: WrittenNote[], now: string): Promise<number> {
  const rows: RatingTagRow[] = [];

  for (const note of apiNotes) {
    if (!note.scoring_status?.has_access) continue;
    const perModel = note.scoring_status.rating_counts_per_model;
    if (!perModel) continue;

    for (const [modelName, modelData] of Object.entries(perModel)) {
      const bucketsByName: Array<[RaterBucket, NoteFactorBucketCounts | undefined]> = [
        ["negative", modelData?.negative_factor_bucket_counts],
        ["neutral", modelData?.neutral_factor_bucket_counts],
        ["positive", modelData?.positive_factor_bucket_counts],
      ];
      for (const [bucket, counts] of bucketsByName) {
        if (!counts) continue;
        const helpful = buildTagRow(note.id, modelName, bucket, counts.helpful_tag_counts, now);
        const notHelpful = buildTagRow(note.id, modelName, bucket, counts.not_helpful_tag_counts, now);
        if (helpful) rows.push(helpful);
        if (notHelpful) rows.push(notHelpful);
      }
    }
  }

  if (rows.length === 0) {
    console.log("[updateFeedback] Rating tags: 0 rows (no notes with has_access=true)");
    return 0;
  }

  let upserted = 0;
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const batch = rows.slice(i, i + PAGE_SIZE);
    const { error } = await client
      .from("note_rating_tag_counts")
      .upsert(batch, { onConflict: "note_id,model_name,tag_name,rater_bucket" });
    if (error) {
      console.error(`[updateFeedback] Error upserting rating-tag batch: ${error.message}`);
    } else {
      upserted += batch.length;
    }
  }
  console.log(`[updateFeedback] Rating tags: ${upserted} upserted`);
  return upserted;
}

// ─── Stage J: cleanup ────────────────────────────────────────────────────────

function cleanupFiles(paths: string[]): void {
  try {
    for (const p of paths) if (existsSync(p)) unlinkSync(p);
    console.log("[updateFeedback] Cleaned up data files");
  } catch {
    console.log("[updateFeedback] Note: could not clean up some data files");
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[updateFeedback] Starting...");

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("[updateFeedback] Missing Supabase credentials");
    process.exit(1);
  }

  const now = new Date().toISOString();

  // A. X API.
  console.log("[updateFeedback] Fetching our notes from X API...");
  let apiNotes: WrittenNote[] = [];
  try {
    apiNotes = await fetchNotesWritten();
    console.log(`[updateFeedback] API returned ${apiNotes.length} notes`);
  } catch (err: any) {
    console.warn(`[updateFeedback] API fetch failed (non-fatal, falling back to dump): ${err.message || err}`);
  }

  // B. Public dump.
  const files = await downloadPublicDump();
  if (!files) process.exit(1);
  const snapshotDate = files.dateStr.replace(/\//g, "-");

  // D. Existing DB state (must precede C — parse uses rejected tweet IDs).
  const existing = await fetchExistingState();

  // C. Parse dump.
  const dump = parsePublicDump(files, existing.rejectedTweetIds);

  // E. Upsert our notes.
  const upsertResult = await upsertOurNotes(
    apiNotes,
    dump.ourNotesFromDump,
    dump.statusMap,
    existing,
    now,
  );
  if (upsertResult.newlyHelpful > 0) {
    console.log(`[updateFeedback] ${upsertResult.newlyHelpful} notes newly rated HELPFUL!`);
  }

  // F.
  await upsertCompetingNotes(dump.competing, dump.statusMap, now);

  // G.
  const missedInserted = await replaceMissedOpportunityNotes(dump.missed, dump.statusMap, now);

  // H. Snapshots.
  await snapshotPublicData(apiNotes, dump.ourNotesFromDump, dump.competing, dump.statusMap, snapshotDate);

  // I. Rating tag counts (no-op when no API note has has_access=true).
  await upsertRatingTagCounts(apiNotes, now);

  // J. Cleanup.
  cleanupFiles([...files.notesPaths, ...files.statusPaths]);

  // Summary.
  const helpfulCompeting = dump.competing.filter(
    (cn) => dump.statusMap.get(cn.noteId)?.currentStatus === STATUS_HELPFUL,
  );
  console.log("\n=== DONE ===");
  console.log(`API: ${apiNotes.length} notes | Dump: ${dump.ourNotesFromDump.size} of our notes`);
  console.log(`Notes: ${upsertResult.upserted} upserted, ${upsertResult.errors} errors`);
  console.log(`Competing: ${dump.competing.length} found, ${helpfulCompeting.length} helpful`);
  console.log(`Missed (helpful): ${missedInserted} inserted`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[updateFeedback] Fatal error:", err);
  process.exit(1);
});
