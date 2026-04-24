import "dotenv/config";
import { getSupabaseClient } from "../api/supabaseClient";
import { fetchNotesWritten } from "../api/fetchNotesWritten";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";

/**
 * Daily job: update canonical_note_information + competing_notes from CN public data dumps.
 *
 * Pipeline stages (see main()):
 *   download → parse TSVs → fetch existing DB state → sync canonical →
 *   sync competing → replace missed opportunities → snapshot → sync notes table →
 *   overlay with X API statuses → cleanup.
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

const CN_STATUS_HELPFUL = "CURRENTLY_RATED_HELPFUL";
const CN_STATUS_NOT_HELPFUL = "CURRENTLY_RATED_NOT_HELPFUL";
const CN_STATUS_NMR = "NEEDS_MORE_RATINGS";
const TERMINAL_STATUSES = new Set([CN_STATUS_HELPFUL, CN_STATUS_NOT_HELPFUL]);
const isTerminalStatus = (s: string | null | undefined): boolean => !!s && TERMINAL_STATUSES.has(s);

const useLocal = process.argv.includes("--local");
if (useLocal) {
  console.log("[updateFeedback] Using LOCAL Supabase");
  process.env.SUPABASE_URL = process.env.LOCAL_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_KEY = process.env.LOCAL_SUPABASE_SERVICE_KEY;
}
const client = getSupabaseClient();
type SupabaseClient = typeof client;

// ─── Types ───────────────────────────────────────────────────────────────────

type OurNote = {
  noteId: string;
  tweetId: string;
  createdAtMillis: string;
  classification: string;
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

type PublicNotes = {
  ourNotes: Map<string, OurNote>;
  competingNotes: CompetingNote[];
  missedNotes: MissedNote[];
};

type StatusRecord = {
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
};

type NotesEnrichment = { submitted_at: string | null; bot_name: string | null };
type RejectedRun = { runId: string; outcomeReason: string | null };

type ExistingCanonical = {
  ids: Set<string>;
  statusMap: Map<string, string | null>;
};

type PublicDataFiles = {
  notesPaths: string[];
  statusPaths: string[];
  snapshotDate: string;
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
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  console.log(`[updateFeedback] Downloading ${url}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const buffer = await response.arrayBuffer();
  writeFileSync(outputPath, Buffer.from(buffer));
}

async function downloadCNFile(
  fileType: "noteStatusHistory" | "notes",
): Promise<{ paths: string[]; dateStr: string } | null> {
  for (let daysBack = 0; daysBack < MAX_DAYS_BACK_FOR_CN_DATA; daysBack++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - daysBack);
    const dateStr = formatDateForUrl(date);

    const testUrl = `${CN_DATA_BASE_URL}/${dateStr}/${fileType}/${fileType}-00000.zip`;
    const testZip = `${DATA_DIR}/${fileType}-00000.zip`;
    const testTsv = `${DATA_DIR}/${fileType}-00000.tsv`;

    try {
      await downloadFile(testUrl, testZip);
      execSync(`unzip -o "${testZip}" -d "${DATA_DIR}"`, { stdio: "pipe" });
      unlinkSync(testZip);

      const paths = [testTsv];
      for (const partition of (PARTITIONS[fileType] ?? []).slice(1)) {
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

function readTsvLines(paths: string[]): { header: string; lines: string[] } {
  let header = "";
  const lines: string[] = [];
  for (const p of paths) {
    const content = readFileSync(p, "utf-8");
    const fileLines = content.split("\n");
    if (!header && fileLines[0]) header = fileLines[0];
    for (let i = 1; i < fileLines.length; i++) {
      if (fileLines[i]) lines.push(fileLines[i]!);
    }
  }
  return { header, lines };
}

function millisToIso(millis: string | undefined): string | null {
  return millis ? new Date(parseInt(millis)).toISOString() : null;
}

// ─── Parse stage ─────────────────────────────────────────────────────────────

function parseNotesFile(
  paths: string[],
  rejectedByTweetId: Map<string, RejectedRun>,
): PublicNotes {
  const { header, lines } = readTsvLines(paths);
  const cols = header.split("\t");
  const idx = {
    noteId: cols.indexOf("noteId"),
    author: cols.indexOf("noteAuthorParticipantId"),
    tweetId: cols.indexOf("tweetId"),
    createdAtMillis: cols.indexOf("createdAtMillis"),
    classification: cols.indexOf("classification"),
    summary: cols.indexOf("summary"),
  };

  const ourNotes = new Map<string, OurNote>();
  const tweetIdToOurNoteId = new Map<string, string>();

  // Pass 1: collect our notes so competing/missed passes can distinguish them.
  for (const line of lines) {
    const vals = line.split("\t");
    if (vals[idx.author] !== OUR_AUTHOR) continue;
    const noteId = vals[idx.noteId]!;
    const tweetId = vals[idx.tweetId]!;
    ourNotes.set(noteId, {
      noteId,
      tweetId,
      createdAtMillis: vals[idx.createdAtMillis]!,
      classification: vals[idx.classification]!,
      summary: vals[idx.summary]!,
    });
    tweetIdToOurNoteId.set(tweetId, noteId);
  }

  // A tweet where we submitted is never a "missed opportunity" even if the pipeline also rejected another attempt.
  for (const n of ourNotes.values()) rejectedByTweetId.delete(n.tweetId);

  // Pass 2: competing (other author, tweet we noted) and missed (other author, tweet we rejected).
  const competingNotes: CompetingNote[] = [];
  const missedNotes: MissedNote[] = [];
  for (const line of lines) {
    const vals = line.split("\t");
    if (vals[idx.author] === OUR_AUTHOR) continue;

    const tweetId = vals[idx.tweetId]!;
    const base: OtherNote = {
      noteId: vals[idx.noteId]!,
      tweetId,
      authorId: vals[idx.author] || "",
      summary: vals[idx.summary] || "",
      classification: vals[idx.classification] || "",
      createdAtMillis: vals[idx.createdAtMillis] || "",
    };

    const ourNoteId = tweetIdToOurNoteId.get(tweetId);
    if (ourNoteId) {
      competingNotes.push({ ...base, ourNoteId });
      continue;
    }
    const rejected = rejectedByTweetId.get(tweetId);
    if (rejected) {
      missedNotes.push({ ...base, pipelineRunId: rejected.runId });
    }
  }

  return { ourNotes, competingNotes, missedNotes };
}

function parseStatusHistory(paths: string[], relevantIds: Set<string>): Map<string, StatusRecord> {
  const { header, lines } = readTsvLines(paths);
  const cols = header.split("\t");
  const idx = {
    noteId: cols.indexOf("noteId"),
    currentStatus: cols.indexOf("currentStatus"),
    currentCoreStatus: cols.indexOf("currentCoreStatus"),
    currentExpansionStatus: cols.indexOf("currentExpansionStatus"),
    currentGroupStatus: cols.indexOf("currentGroupStatus"),
    currentDecidedBy: cols.indexOf("currentDecidedBy"),
    currentModelingGroup: cols.indexOf("currentModelingGroup"),
    firstNonNMRStatus: cols.indexOf("firstNonNMRStatus"),
    mostRecentNonNMRStatus: cols.indexOf("mostRecentNonNMRStatus"),
    lockedStatus: cols.indexOf("lockedStatus"),
    timestampMillisOfCurrentStatus: cols.indexOf("timestampMillisOfCurrentStatus"),
    timestampMillisOfFirstNonNMRStatus: cols.indexOf("timestampMillisOfFirstNonNMRStatus"),
    timestampMillisOfStatusLock: cols.indexOf("timestampMillisOfStatusLock"),
  };

  const statusMap = new Map<string, StatusRecord>();
  for (const line of lines) {
    const firstTab = line.indexOf("\t");
    const noteId = line.slice(0, firstTab);
    if (!relevantIds.has(noteId)) continue;

    const vals = line.split("\t");
    statusMap.set(noteId, {
      currentStatus: vals[idx.currentStatus] || "",
      currentCoreStatus: vals[idx.currentCoreStatus] || "",
      currentExpansionStatus: vals[idx.currentExpansionStatus] || "",
      currentGroupStatus: vals[idx.currentGroupStatus] || "",
      currentDecidedBy: vals[idx.currentDecidedBy] || "",
      currentModelingGroup: vals[idx.currentModelingGroup] || "",
      firstNonNMRStatus: vals[idx.firstNonNMRStatus] || "",
      mostRecentNonNMRStatus: vals[idx.mostRecentNonNMRStatus] || "",
      lockedStatus: vals[idx.lockedStatus] || "",
      statusUpdatedAt: millisToIso(vals[idx.timestampMillisOfCurrentStatus]),
      firstNonNmrAt: millisToIso(vals[idx.timestampMillisOfFirstNonNMRStatus]),
      statusLockedAt: millisToIso(vals[idx.timestampMillisOfStatusLock]),
    });
  }
  return statusMap;
}

// ─── DB read stage ───────────────────────────────────────────────────────────

async function fetchRejectedTweets(client: SupabaseClient): Promise<Map<string, RejectedRun>> {
  const rejectedRuns = await fetchAll<{ id: string; tweet_id: string; outcome_reason: string | null }>(
    () => client.from("pipeline_runs").select("id, tweet_id, outcome_reason").eq("outcome", "rejected"),
  );
  const map = new Map<string, RejectedRun>();
  // Iteration order is insertion order → the last run per tweet wins, which is what we want.
  for (const run of rejectedRuns) {
    map.set(run.tweet_id, { runId: run.id, outcomeReason: run.outcome_reason });
  }
  return map;
}

async function fetchExistingCanonical(client: SupabaseClient): Promise<ExistingCanonical> {
  const rows = await fetchAll<{ note_id: string; cn_status: string | null }>(
    () => client.from("canonical_note_information").select("note_id, cn_status"),
  );
  return {
    ids: new Set(rows.map(r => r.note_id)),
    statusMap: new Map(rows.map(r => [r.note_id, r.cn_status])),
  };
}

async function fetchNotesEnrichment(client: SupabaseClient): Promise<Map<string, NotesEnrichment>> {
  const rows = await fetchAll<{ note_id: string; submitted_at: string | null; bot_name: string | null }>(
    () => client.from("notes").select("note_id, submitted_at, bot_name"),
  );
  return new Map(rows.map(r => [r.note_id, { submitted_at: r.submitted_at, bot_name: r.bot_name }]));
}

// ─── Row builders ────────────────────────────────────────────────────────────

function buildCanonicalRow(
  ourNote: OurNote,
  status: StatusRecord | undefined,
  enrichment: NotesEnrichment | undefined,
  now: string,
): Record<string, any> {
  return {
    note_id: ourNote.noteId,
    tweet_id: ourNote.tweetId,
    cn_status: status?.currentStatus || CN_STATUS_NMR,
    note_text: ourNote.summary || null,
    classification: ourNote.classification || null,
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
    submitted_at: millisToIso(ourNote.createdAtMillis) || enrichment?.submitted_at || null,
    bot_name: enrichment?.bot_name || null,
  };
}

function buildCompetingRow(cn: CompetingNote, status: StatusRecord | undefined, now: string): Record<string, any> {
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
}

function buildMissedRow(mn: MissedNote, status: StatusRecord, now: string): Record<string, any> {
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
}

// ─── DB write stage ──────────────────────────────────────────────────────────

async function upsertBatches(
  client: SupabaseClient,
  table: string,
  rows: Record<string, any>[],
  onConflict: string,
  label: string,
): Promise<{ upserted: number; errors: number }> {
  let upserted = 0, errors = 0;
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const batch = rows.slice(i, i + PAGE_SIZE);
    const { error } = await client.from(table).upsert(batch, { onConflict });
    if (error) {
      console.error(`[updateFeedback] Error upserting ${label} batch: ${error.message}`);
      errors += batch.length;
    } else {
      upserted += batch.length;
    }
  }
  return { upserted, errors };
}

type CanonicalSyncResult = {
  upserted: number;
  skipped: number;
  newlyHelpful: number;
  errors: number;
  postUpsertIds: Set<string>;
  postUpsertStatusMap: Map<string, string | null>;
};

async function syncCanonical(
  client: SupabaseClient,
  params: {
    ourNotes: Map<string, OurNote>;
    statusMap: Map<string, StatusRecord>;
    existing: ExistingCanonical;
    enrichmentMap: Map<string, NotesEnrichment>;
    now: string;
  },
): Promise<CanonicalSyncResult> {
  const { ourNotes, statusMap, existing, enrichmentMap, now } = params;

  // Separate new vs existing rows: PostgREST normalizes all rows in a batch to the
  // same columns — mixing rows with/without first_seen_at would set existing rows'
  // first_seen_at to NULL, violating NOT NULL.
  const newRows: Record<string, any>[] = [];
  const existingRows: Record<string, any>[] = [];
  let skipped = 0;
  let newlyHelpful = 0;

  for (const ourNote of ourNotes.values()) {
    const status = statusMap.get(ourNote.noteId);
    const newStatus = status?.currentStatus || CN_STATUS_NMR;
    const existingStatus = existing.statusMap.get(ourNote.noteId);

    if (existingStatus !== CN_STATUS_HELPFUL && newStatus === CN_STATUS_HELPFUL) newlyHelpful++;

    // Terminal + unchanged = skip the write.
    if (existing.ids.has(ourNote.noteId) && existingStatus === newStatus && isTerminalStatus(newStatus)) {
      skipped++;
      continue;
    }

    const row = buildCanonicalRow(ourNote, status, enrichmentMap.get(ourNote.noteId), now);
    if (existing.ids.has(ourNote.noteId)) {
      existingRows.push(row);
    } else {
      row.first_seen_at = now;
      newRows.push(row);
    }
  }

  // Return new state maps instead of mutating the caller's copies. The API overlay
  // step needs post-upsert state; the notes-table sync needs pre-upsert state.
  const postUpsertIds = new Set(existing.ids);
  const postUpsertStatusMap = new Map(existing.statusMap);

  let upserted = 0, errors = 0;
  for (const rows of [newRows, existingRows]) {
    for (let i = 0; i < rows.length; i += PAGE_SIZE) {
      const batch = rows.slice(i, i + PAGE_SIZE);
      const { error } = await client.from("canonical_note_information").upsert(batch, { onConflict: "note_id" });
      if (error) {
        console.error(`[updateFeedback] Error upserting canonical batch: ${error.message}`);
        errors += batch.length;
      } else {
        upserted += batch.length;
        for (const row of batch) {
          postUpsertIds.add(row.note_id);
          postUpsertStatusMap.set(row.note_id, row.cn_status);
        }
      }
    }
  }

  return { upserted, skipped, newlyHelpful, errors, postUpsertIds, postUpsertStatusMap };
}

async function syncCompetingNotes(
  client: SupabaseClient,
  competingNotes: CompetingNote[],
  statusMap: Map<string, StatusRecord>,
  now: string,
): Promise<{ upserted: number; errors: number }> {
  const rows = competingNotes.map(cn => buildCompetingRow(cn, statusMap.get(cn.noteId), now));
  return upsertBatches(client, "competing_notes", rows, "note_id,our_note_id", "competing");
}

async function replaceMissedOpportunities(
  client: SupabaseClient,
  missedNotes: MissedNote[],
  statusMap: Map<string, StatusRecord>,
  now: string,
): Promise<number> {
  const rows = missedNotes
    .filter(mn => statusMap.get(mn.noteId)?.currentCoreStatus === CN_STATUS_HELPFUL)
    .map(mn => buildMissedRow(mn, statusMap.get(mn.noteId)!, now));

  await client.from("competing_notes").delete().is("our_note_id", null);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const batch = rows.slice(i, i + PAGE_SIZE);
    const { error } = await client.from("competing_notes").insert(batch);
    if (error) {
      console.error(`[updateFeedback] Error inserting missed opportunity competing notes: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }
  return inserted;
}

async function snapshotPublicData(
  client: SupabaseClient,
  params: {
    ourNotes: Map<string, OurNote>;
    competingNotes: CompetingNote[];
    statusMap: Map<string, StatusRecord>;
    snapshotDate: string;
  },
): Promise<number> {
  const { ourNotes, competingNotes, statusMap, snapshotDate } = params;
  let count = 0;

  const upsertSnapshot = async (row: Record<string, any>) => {
    try {
      const { error } = await client
        .from("public_data_snapshots")
        .upsert(row, { onConflict: "note_id,snapshot_date", ignoreDuplicates: false });
      if (!error) count++;
    } catch {
      // Ignore duplicates
    }
  };

  for (const ourNote of ourNotes.values()) {
    const status = statusMap.get(ourNote.noteId);
    await upsertSnapshot({
      note_id: ourNote.noteId,
      tweet_id: ourNote.tweetId,
      current_status: status?.currentStatus || CN_STATUS_NMR,
      is_ours: true,
      snapshot_date: snapshotDate,
      created_at_millis: ourNote.createdAtMillis ? parseInt(ourNote.createdAtMillis) : undefined,
    });
  }

  for (const cn of competingNotes) {
    const status = statusMap.get(cn.noteId);
    if (status?.currentStatus !== CN_STATUS_HELPFUL) continue;
    await upsertSnapshot({
      note_id: cn.noteId,
      tweet_id: cn.tweetId,
      current_status: status.currentStatus,
      is_ours: false,
      snapshot_date: snapshotDate,
      created_at_millis: cn.createdAtMillis ? parseInt(cn.createdAtMillis) : undefined,
      note_text: cn.summary || null,
    });
  }

  return count;
}

async function syncNotesTable(
  client: SupabaseClient,
  params: {
    ourNotes: Map<string, OurNote>;
    statusMap: Map<string, StatusRecord>;
    preUpsertStatusMap: Map<string, string | null>;
    notesTableIdSet: Set<string>;
    now: string;
  },
): Promise<{ updated: number; skipped: number }> {
  const { ourNotes, statusMap, preUpsertStatusMap, notesTableIdSet, now } = params;
  let updated = 0, skipped = 0;

  for (const ourNote of ourNotes.values()) {
    if (!notesTableIdSet.has(ourNote.noteId)) continue;
    const resolvedStatus = statusMap.get(ourNote.noteId)?.currentStatus || CN_STATUS_NMR;

    if (preUpsertStatusMap.get(ourNote.noteId) === resolvedStatus && isTerminalStatus(resolvedStatus)) {
      skipped++;
      continue;
    }

    const { error } = await client
      .from("notes")
      .update({ cn_status: resolvedStatus, last_checked_at: now })
      .eq("note_id", ourNote.noteId);
    if (!error) updated++;
  }

  return { updated, skipped };
}

async function overlayApiStatus(
  client: SupabaseClient,
  params: {
    canonicalIds: Set<string>;
    canonicalStatusMap: Map<string, string | null>;
    notesTableIdSet: Set<string>;
    enrichmentMap: Map<string, NotesEnrichment>;
    now: string;
  },
): Promise<{ overlayCount: number; newCount: number }> {
  const { canonicalIds, canonicalStatusMap, notesTableIdSet, enrichmentMap, now } = params;

  try {
    console.log("[updateFeedback] Fetching real-time statuses from X API...");
    const apiNotes = await fetchNotesWritten();
    console.log(`[updateFeedback] API returned ${apiNotes.length} notes`);

    const overlayRows: Array<{ note_id: string; cn_status: string; public_data_updated_at: string }> = [];
    const newApiRows: Record<string, any>[] = [];

    for (const note of apiNotes) {
      const apiStatus = note.status?.toUpperCase() || null;
      const apiClassification = note.info?.classification?.toUpperCase() || null;

      if (canonicalIds.has(note.id)) {
        if (apiStatus && apiStatus !== canonicalStatusMap.get(note.id)) {
          overlayRows.push({ note_id: note.id, cn_status: apiStatus, public_data_updated_at: now });
        }
      } else {
        const enrichment = enrichmentMap.get(note.id);
        newApiRows.push({
          note_id: note.id,
          tweet_id: note.post_id,
          cn_status: apiStatus || CN_STATUS_NMR,
          note_text: note.info?.text || null,
          classification: apiClassification,
          public_data_updated_at: now,
          first_seen_at: now,
          submitted_at: enrichment?.submitted_at || null,
          bot_name: enrichment?.bot_name || null,
        });
      }
    }

    let overlayCount = 0;
    for (const row of overlayRows) {
      const { error } = await client
        .from("canonical_note_information")
        .update({ cn_status: row.cn_status, public_data_updated_at: row.public_data_updated_at })
        .eq("note_id", row.note_id);
      if (!error) overlayCount++;
    }

    let newCount = 0;
    for (let i = 0; i < newApiRows.length; i += PAGE_SIZE) {
      const batch = newApiRows.slice(i, i + PAGE_SIZE);
      const { error } = await client.from("canonical_note_information").upsert(batch, { onConflict: "note_id" });
      if (!error) newCount += batch.length;
    }

    // Mirror status changes into the notes table too, for rows that exist there.
    for (const row of overlayRows) {
      if (notesTableIdSet.has(row.note_id)) {
        await client
          .from("notes")
          .update({ cn_status: row.cn_status, last_checked_at: now })
          .eq("note_id", row.note_id);
      }
    }

    console.log(`[updateFeedback] API overlay: ${overlayCount} statuses updated, ${newCount} new notes added`);
    return { overlayCount, newCount };
  } catch (err: any) {
    console.warn(`[updateFeedback] API step failed (non-fatal): ${err.message || err}`);
    return { overlayCount: 0, newCount: 0 };
  }
}

function cleanupDataFiles(paths: string[]): void {
  try {
    for (const p of paths) if (existsSync(p)) unlinkSync(p);
    console.log("[updateFeedback] Cleaned up data files");
  } catch {
    console.log("[updateFeedback] Note: could not clean up some data files");
  }
}

async function downloadPublicDataFiles(): Promise<PublicDataFiles | null> {
  const notesResult = await downloadCNFile("notes");
  if (!notesResult) return null;
  const statusResult = await downloadCNFile("noteStatusHistory");
  if (!statusResult) return null;
  return {
    notesPaths: notesResult.paths,
    statusPaths: statusResult.paths,
    snapshotDate: statusResult.dateStr.replace(/\//g, "-"),
  };
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

async function main() {
  console.log("[updateFeedback] Starting public data feedback update...");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("[updateFeedback] Missing Supabase credentials");
    process.exit(1);
  }

  const files = await downloadPublicDataFiles();
  if (!files) process.exit(1);

  console.log("[updateFeedback] Parsing notes file...");
  const rejectedByTweetId = await fetchRejectedTweets(client);
  console.log(`[updateFeedback] ${rejectedByTweetId.size} rejected-run tweets before exclusion`);

  const { ourNotes, competingNotes, missedNotes } = parseNotesFile(files.notesPaths, rejectedByTweetId);
  console.log(`[updateFeedback] Found ${ourNotes.size} of our notes, ${competingNotes.length} competing, ${missedNotes.length} missed-opportunity candidates`);

  console.log("[updateFeedback] Parsing noteStatusHistory...");
  const relevantIds = new Set<string>([
    ...ourNotes.keys(),
    ...competingNotes.map(n => n.noteId),
    ...missedNotes.map(n => n.noteId),
  ]);
  const statusMap = parseStatusHistory(files.statusPaths, relevantIds);
  console.log(`[updateFeedback] Found ${statusMap.size} status records for relevant notes`);

  console.log("[updateFeedback] Fetching existing DB state...");
  const existingCanonical = await fetchExistingCanonical(client);
  const enrichmentMap = await fetchNotesEnrichment(client);
  const notesTableIdSet = new Set(enrichmentMap.keys());
  console.log(`[updateFeedback] ${existingCanonical.ids.size} canonical rows, ${notesTableIdSet.size} notes-table rows`);

  const now = new Date().toISOString();

  const canonicalResult = await syncCanonical(client, {
    ourNotes,
    statusMap,
    existing: existingCanonical,
    enrichmentMap,
    now,
  });
  console.log(`[updateFeedback] Canonical: ${canonicalResult.upserted} upserted, ${canonicalResult.skipped} skipped (unchanged terminal), ${canonicalResult.errors} errors`);
  if (canonicalResult.newlyHelpful > 0) {
    console.log(`[updateFeedback] ${canonicalResult.newlyHelpful} notes newly rated HELPFUL!`);
  }

  console.log("[updateFeedback] Upserting competing notes...");
  const competingResult = await syncCompetingNotes(client, competingNotes, statusMap, now);
  console.log(`[updateFeedback] Competing: ${competingResult.upserted} upserted, ${competingResult.errors} errors`);

  console.log("[updateFeedback] Replacing missed opportunity competing notes...");
  const missedInserted = await replaceMissedOpportunities(client, missedNotes, statusMap, now);
  console.log(`[updateFeedback] Missed opportunity competing notes: ${missedInserted} inserted (helpful only)`);

  console.log("[updateFeedback] Creating public data snapshots...");
  const snapshotCount = await snapshotPublicData(client, {
    ourNotes,
    competingNotes,
    statusMap,
    snapshotDate: files.snapshotDate,
  });
  console.log(`[updateFeedback] Created/updated ${snapshotCount} snapshots`);

  // Notes-table sync needs the PRE-upsert status (canonicalResult has post-upsert state).
  const notesTableResult = await syncNotesTable(client, {
    ourNotes,
    statusMap,
    preUpsertStatusMap: existingCanonical.statusMap,
    notesTableIdSet,
    now,
  });
  console.log(`[updateFeedback] Updated ${notesTableResult.updated} notes in notes table (${notesTableResult.skipped} skipped)`);

  const apiResult = await overlayApiStatus(client, {
    canonicalIds: canonicalResult.postUpsertIds,
    canonicalStatusMap: canonicalResult.postUpsertStatusMap,
    notesTableIdSet,
    enrichmentMap,
    now,
  });

  cleanupDataFiles([...files.notesPaths, ...files.statusPaths]);

  const helpfulCompeting = competingNotes.filter(
    cn => statusMap.get(cn.noteId)?.currentStatus === CN_STATUS_HELPFUL,
  ).length;
  if (helpfulCompeting > 0) {
    console.log(`[updateFeedback] ${helpfulCompeting} competing notes are HELPFUL`);
  }

  console.log(`\n=== DONE ===`);
  console.log(`Our notes: ${ourNotes.size} found, ${canonicalResult.upserted} upserted, ${canonicalResult.errors} errors`);
  console.log(`Competing notes: ${competingNotes.length} found, ${competingResult.upserted} upserted`);
  console.log(`Missed opportunity competing notes: ${missedInserted} inserted`);
  console.log(`Snapshots: ${snapshotCount}`);
  console.log(`Notes table: ${notesTableResult.updated} synced`);
  console.log(`API overlay: ${apiResult.overlayCount} updated, ${apiResult.newCount} new`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[updateFeedback] Fatal error:", err);
  process.exit(1);
});
