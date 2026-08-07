import "dotenv/config";
import { getSupabaseClient } from "../api/supabaseClient";
import { fetchAllRows } from "../api/paging";
import { fetchNotesWritten, type WrittenNote, type NoteFactorBucketCounts } from "../api/fetchNotesWritten";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";

/**
 * This is a cron job. It refreshes our note tables from two sources. One is the X API.
 * The other is the public Community Notes data dump.
 *
 * The run has these stages.
 *   A. Fetch our own notes from the X API. This is the primary source for a note's
 *      status and text.
 *   B. Download the public dump. It supplies the competing notes, the missed
 *      opportunities, and a fallback status for our own notes.
 *   C. Parse the dump. A map from tweet id to note id keeps the work linear in the
 *      number of rows.
 *   D. Fetch the state we already hold in the database. That is the rejected pipeline
 *      runs, plus the note ids, submission times and statuses of the notes we know.
 *   E. Upsert our notes into `notes` in batches.
 *   F. Upsert the competing notes into `competing_notes` in batches.
 *   G. Replace the missed-opportunity rows in `competing_notes`. Only notes that are
 *      currently rated helpful are kept.
 *   H. Upsert into `public_data_snapshots` in batches.
 *   I. Upsert into `note_rating_tag_counts` in batches. Only notes whose ratings X lets
 *      us read produce rows here.
 *   K. Upsert the daily origin counts into `daily_note_origin_counts`.
 *   J. Delete the files we downloaded.
 *
 * A run costs about 10 Supabase round-trips. Earlier versions of two of these stages
 * wrote one row per request and cost about 1300.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const CN_DATA_BASE_URL = "https://ton.twimg.com/birdwatch-public-data";
const DATA_DIR = "./cn-data";
const OUR_AUTHOR = "813EB394B10809EBA8D09BCFA8E2E1C25A2DA0085186867F9E9C00696951C447";
const PAGE_SIZE = 1000;
// The public_data_snapshots table is large. It holds more than 400 thousand rows.
// Smaller upsert batches keep each statement under the database timeout.
const SNAPSHOT_PAGE_SIZE = 500;
const MAX_DAYS_BACK_FOR_CN_DATA = 7;
// The dump splits each file across a growing number of partitions. Their names are
// zero padded, such as notes-00000.zip and notes-00001.zip. We do not know how many
// there are, so we keep fetching partitions until one comes back as a 404. A hardcoded
// list would go stale as soon as X adds a partition. This constant only stops a
// runaway loop.
const MAX_PARTITIONS = 100;
const STATUS_HELPFUL = "CURRENTLY_RATED_HELPFUL";
const STATUS_NMR = "NEEDS_MORE_RATINGS";

// This file holds the author ids of the known AI notewriters. They are hashed
// noteAuthorParticipantId values, and our own id is one of them. The other AI writers
// are this list without ours. We keep only the most productive of them, ranked by how
// many helpful notes they have written.
const AI_AUTHOR_IDS_FILE = join(import.meta.dir, "../../datasets/big_eval/ai_author_ids.txt");
const TOP_OTHER_AI_AUTHORS = 9;

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

// Column indices into a notes.tsv row, resolved from its header.
type NoteColumnIndex = {
  noteId: number;
  author: number;
  tweetId: number;
  createdAtMillis: number;
  classification: number;
  summary: number;
};

// One row of daily_note_origin_counts. It splits the helpful notes created on one UTC
// day by who wrote them. The number written by humans is not stored. Readers derive it
// as helpful_total minus helpful_ours minus helpful_other_ai.
type DailyOriginCount = {
  day: string;
  helpful_total: number;
  helpful_ours: number;
  helpful_other_ai: number;
};

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
  originCounts: DailyOriginCount[];
};

type ExistingState = {
  // This maps a tweet id to the id of a rejected pipeline run on that tweet. A tweet
  // can have several rejected runs. We keep only one of them, and which one we keep
  // depends on the order the rows came back in, so it is effectively arbitrary.
  rejectedTweetIds: Map<string, string>;
  existingNoteIds: Set<string>;
  existingSubmittedAt: Map<string, string | null>;
  existingStatuses: Map<string, string | null>;
};

// ─── Generic helpers ─────────────────────────────────────────────────────────
// Pagination lives in fetchAllRows in src/api/paging.ts. This file has no copy of it.

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

/** Postgres text columns cannot hold NUL bytes. A single one makes the whole upsert
 *  batch fail with "unsupported Unicode escape sequence", and the 999 good rows in
 *  that batch are lost with it. So we remove NUL bytes from every piece of text that
 *  comes out of the dump or the API before it reaches the database. */
function stripNulBytes(s: string): string {
  return s.replace(/\u0000/g, "");
}

function readTsvLines(paths: string[]): { header: string; lines: string[] } {
  let header = "";
  const lines: string[] = [];
  for (const p of paths) {
    const fileLines = stripNulBytes(readFileSync(p, "utf-8")).split("\n");
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

    const partitionUrl = (partition: string) =>
      `${CN_DATA_BASE_URL}/${dateStr}/${fileType}/${fileType}-${partition}.zip`;
    const firstTsv = `${DATA_DIR}/${fileType}-00000.tsv`;
    const firstZip = `${DATA_DIR}/${fileType}-00000.zip`;

    try {
      // Every published day has a partition 00000. If it is missing, X has not
      // published this day yet.
      await downloadFile(partitionUrl("00000"), firstZip);
      execSync(`unzip -o "${firstZip}" -d "${DATA_DIR}"`, { stdio: "pipe" });
      unlinkSync(firstZip);

      // Then keep pulling partition 00001, 00002 and so on. The first one that fails
      // to download marks the end of the list.
      const paths = [firstTsv];
      for (let i = 1; i < MAX_PARTITIONS; i++) {
        const partition = String(i).padStart(5, "0");
        const zipPath = `${DATA_DIR}/${fileType}-${partition}.zip`;
        const tsvPath = `${DATA_DIR}/${fileType}-${partition}.tsv`;
        try {
          await downloadFile(partitionUrl(partition), zipPath);
          execSync(`unzip -o "${zipPath}" -d "${DATA_DIR}"`, { stdio: "pipe" });
          unlinkSync(zipPath);
          paths.push(tsvPath);
        } catch {
          break;
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
  otherAiAuthorIds: Set<string>,
): ParsedDump {
  console.log("[updateFeedback] Parsing notes file...");
  const { header: nHeader, lines: nLines } = readTsvLines(files.notesPaths);
  const nh = nHeader.split("\t");
  const nIdx: NoteColumnIndex = {
    noteId: nh.indexOf("noteId"),
    author: nh.indexOf("noteAuthorParticipantId"),
    tweetId: nh.indexOf("tweetId"),
    createdAtMillis: nh.indexOf("createdAtMillis"),
    classification: nh.indexOf("classification"),
    summary: nh.indexOf("summary"),
  };

  // The first pass picks out our own notes. It builds a map from tweet id to note id,
  // and it remembers the day our earliest note was created.
  const ourNotesFromDump = new Map<string, OurNoteFromDump>();
  const ourTweetIdToNoteId = new Map<string, string>();
  let ourEarliestMillis = Infinity;
  for (const line of nLines) {
    const vals = line.split("\t");
    if (vals[nIdx.author] !== OUR_AUTHOR) continue;
    const noteId = vals[nIdx.noteId]!;
    const tweetId = vals[nIdx.tweetId]!;
    const createdAtMillis = vals[nIdx.createdAtMillis]!;
    ourNotesFromDump.set(noteId, { tweetId, createdAtMillis, summary: vals[nIdx.summary]! });
    ourTweetIdToNoteId.set(tweetId, noteId);
    const ms = Number(createdAtMillis);
    if (Number.isFinite(ms) && ms < ourEarliestMillis) ourEarliestMillis = ms;
  }
  console.log(`[updateFeedback] Found ${ourNotesFromDump.size} of our notes in public data`);
  const ourEarliestDay =
    ourEarliestMillis === Infinity ? null : new Date(ourEarliestMillis).toISOString().slice(0, 10);

  // The second pass collects the competing notes and the missed opportunities in one
  // walk over the same rows.
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

  // This pass records the status of every note the upsert stages care about. It also
  // collects every note on the platform that is currently rated helpful, because the
  // origin counts below need all of them.
  const statusMap = new Map<string, StatusRecord>();
  const helpfulNoteIds = new Set<string>();
  for (const line of sLines) {
    const vals = line.split("\t");
    const noteId = vals[sIdx.noteId]!;
    const currentStatus = vals[sIdx.currentStatus] || "";
    if (currentStatus === STATUS_HELPFUL) helpfulNoteIds.add(noteId);
    if (relevantIds.has(noteId)) statusMap.set(noteId, { currentStatus });
  }
  console.log(`[updateFeedback] Found ${statusMap.size} status records for relevant notes`);
  console.log(`[updateFeedback] ${helpfulNoteIds.size} notes currently rated helpful (platform-wide)`);

  const topOtherAiAuthors = rankTopOtherAiAuthors(nLines, nIdx, helpfulNoteIds, otherAiAuthorIds);
  const originCounts = ourEarliestDay
    ? tallyDailyOriginCounts(nLines, nIdx, helpfulNoteIds, topOtherAiAuthors, ourEarliestDay)
    : [];

  return { ourNotesFromDump, competing, missed, statusMap, originCounts };
}

// Rank the other AI notewriters by how many helpful notes they have in the dump. The
// top few author ids are returned. Those authors get their own segment on the dashboard.
function rankTopOtherAiAuthors(
  nLines: string[],
  nIdx: NoteColumnIndex,
  helpfulNoteIds: Set<string>,
  otherAiAuthorIds: Set<string>,
): Set<string> {
  const helpfulByAuthor = new Map<string, number>();
  for (const line of nLines) {
    const vals = line.split("\t");
    const author = vals[nIdx.author];
    if (!author || !otherAiAuthorIds.has(author)) continue;
    if (!helpfulNoteIds.has(vals[nIdx.noteId]!)) continue;
    helpfulByAuthor.set(author, (helpfulByAuthor.get(author) ?? 0) + 1);
  }
  const top = [...helpfulByAuthor.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_OTHER_AI_AUTHORS);
  console.log(`[updateFeedback] Top ${top.length} other AI notewriters by helpful notes:`);
  for (const [author, count] of top) {
    console.log(`[updateFeedback]   ${author.slice(0, 12)}… ${count} helpful`);
  }
  return new Set(top.map(([author]) => author));
}

// Tally the helpful notes by the UTC day they were created and by who wrote them. A
// note is either ours, or from one of the top other AI notewriters, or from someone
// else. Days before our own first note are skipped. The number written by humans is
// derived later as helpful_total minus helpful_ours minus helpful_other_ai.
function tallyDailyOriginCounts(
  nLines: string[],
  nIdx: NoteColumnIndex,
  helpfulNoteIds: Set<string>,
  topOtherAiAuthors: Set<string>,
  earliestDay: string,
): DailyOriginCount[] {
  const byDay = new Map<string, DailyOriginCount>();
  for (const line of nLines) {
    const vals = line.split("\t");
    if (!helpfulNoteIds.has(vals[nIdx.noteId]!)) continue;
    const millis = Number(vals[nIdx.createdAtMillis]);
    if (!Number.isFinite(millis)) continue;
    const day = new Date(millis).toISOString().slice(0, 10);
    if (day < earliestDay) continue;
    let row = byDay.get(day);
    if (!row) {
      row = { day, helpful_total: 0, helpful_ours: 0, helpful_other_ai: 0 };
      byDay.set(day, row);
    }
    row.helpful_total++;
    const author = vals[nIdx.author];
    if (author === OUR_AUTHOR) row.helpful_ours++;
    else if (author && topOtherAiAuthors.has(author)) row.helpful_other_ai++;
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// Load the author ids of the AI notewriters. Our own id is left out because our notes
// are counted separately.
function loadOtherAiAuthorIds(): Set<string> {
  const ids = readFileSync(AI_AUTHOR_IDS_FILE, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const set = new Set(ids);
  set.delete(OUR_AUTHOR);
  return set;
}

// ─── Stage D: fetch existing DB state ────────────────────────────────────────

async function fetchExistingState(): Promise<ExistingState> {
  console.log("[updateFeedback] Fetching rejected pipeline runs...");
  const rejected = await fetchAllRows<{ id: string; tweet_id: string }>(
    () => client.from("pipeline_runs").select("id, tweet_id").eq("outcome", "rejected"),
    "id",
    { label: "updateFeedback.rejectedRuns" },
  );
  const rejectedTweetIds = new Map<string, string>();
  for (const run of rejected) rejectedTweetIds.set(run.tweet_id, run.id);
  console.log(`[updateFeedback] ${rejectedTweetIds.size} tweets with rejected runs`);

  console.log("[updateFeedback] Fetching existing notes state...");
  const existing = await fetchAllRows<{
    note_id: string;
    cn_status: string | null;
    submitted_at: string | null;
  }>(
    () => client.from("notes").select("note_id, cn_status, submitted_at"),
    "note_id",
    { label: "updateFeedback.existingNotes" },
  );
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

    // The X API returns its status values in lowercase, for example
    // `currently_rated_helpful`. The rest of the system stores the uppercase form that
    // the public dump uses. So we uppercase the API value here.
    const apiStatus = api?.status?.toUpperCase();
    const cn_status = apiStatus || status?.currentStatus || STATUS_NMR;

    const wasHelpful = existing.existingStatuses.get(noteId) === STATUS_HELPFUL;
    if (cn_status === STATUS_HELPFUL && !wasHelpful) newlyHelpful++;

    // readTsvLines already stripped the NUL bytes out of dump.summary. The text from
    // the API has not been stripped yet.
    const rawNoteText = api?.info?.text ?? dump?.summary ?? null;
    const noteText = rawNoteText === null ? null : stripNulBytes(rawNoteText);
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

  // New rows and existing rows go in separate batches. PostgREST makes every row in a
  // batch carry the same set of columns. A batch that mixed rows with first_seen_at and
  // rows without it would write NULL into that column on the existing rows, and the NOT
  // NULL constraint would reject the whole batch.
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

  // Our own notes come from the API and from the dump, deduplicated by note id. When
  // both sources have the same note we keep the dump's version. The dump carries
  // createdAtMillis and the API response does not.
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

  // A competing note is snapshotted only while it is currently rated helpful.
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
  for (let i = 0; i < rows.length; i += SNAPSHOT_PAGE_SIZE) {
    const batch = rows.slice(i, i + SNAPSHOT_PAGE_SIZE);
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

// ─── Stage K: daily origin counts ────────────────────────────────────────────

async function upsertDailyOriginCounts(counts: DailyOriginCount[], now: string): Promise<number> {
  if (counts.length === 0) {
    console.log("[updateFeedback] Origin counts: 0 day rows");
    return 0;
  }
  const rows = counts.map((c) => ({ ...c, last_synced_at: now }));
  let upserted = 0;
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const batch = rows.slice(i, i + PAGE_SIZE);
    const { error } = await client
      .from("daily_note_origin_counts")
      .upsert(batch, { onConflict: "day" });
    if (error) {
      console.error(`[updateFeedback] Error upserting origin-counts batch: ${error.message}`);
    } else {
      upserted += batch.length;
    }
  }
  console.log(`[updateFeedback] Origin counts: ${upserted} day rows upserted`);
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

  // Stage A fetches our notes from the X API.
  console.log("[updateFeedback] Fetching our notes from X API...");
  let apiNotes: WrittenNote[] = [];
  try {
    apiNotes = await fetchNotesWritten();
    console.log(`[updateFeedback] API returned ${apiNotes.length} notes`);
  } catch (err: any) {
    console.warn(`[updateFeedback] API fetch failed (non-fatal, falling back to dump): ${err.message || err}`);
  }

  // Stage B downloads the public dump.
  const files = await downloadPublicDump();
  if (!files) process.exit(1);
  const snapshotDate = files.dateStr.replace(/\//g, "-");

  // Stage D runs before stage C because parsing the dump needs the rejected tweet ids.
  const existing = await fetchExistingState();

  // Stage C parses the dump.
  const otherAiAuthorIds = loadOtherAiAuthorIds();
  const dump = parsePublicDump(files, existing.rejectedTweetIds, otherAiAuthorIds);

  // Stage E upserts our own notes.
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

  // Stage F upserts the competing notes.
  await upsertCompetingNotes(dump.competing, dump.statusMap, now);

  // Stage G replaces the missed-opportunity notes.
  const missedInserted = await replaceMissedOpportunityNotes(dump.missed, dump.statusMap, now);

  // Stage H writes the snapshots.
  await snapshotPublicData(apiNotes, dump.ourNotesFromDump, dump.competing, dump.statusMap, snapshotDate);

  // Stage I writes the rating tag counts. It writes nothing when X grants us no rating
  // access on any of the notes the API returned.
  await upsertRatingTagCounts(apiNotes, now);

  // Stage K writes the daily counts of helpful notes by origin. The stats dashboard
  // uses them for its "% of all" view.
  await upsertDailyOriginCounts(dump.originCounts, now);

  // Stage J deletes the files we downloaded.
  cleanupFiles([...files.notesPaths, ...files.statusPaths]);

  const helpfulCompeting = dump.competing.filter(
    (cn) => dump.statusMap.get(cn.noteId)?.currentStatus === STATUS_HELPFUL,
  );
  console.log("\n=== DONE ===");
  console.log(`API: ${apiNotes.length} notes | Dump: ${dump.ourNotesFromDump.size} of our notes`);
  console.log(`Notes: ${upsertResult.upserted} upserted, ${upsertResult.errors} errors`);
  console.log(`Competing: ${dump.competing.length} found, ${helpfulCompeting.length} helpful`);
  console.log(`Missed (helpful): ${missedInserted} inserted`);
  console.log(`Origin counts: ${dump.originCounts.length} day rows`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[updateFeedback] Fatal error:", err);
  process.exit(1);
});
