/** Exports the public Common Notes data (notes, ratings, the posts they are on)
 *  as tab-separated files shaped like X's public Community Notes download.
 *
 *  Usage: bun run src/scripts_jim/2026_11_13_hackathon_data_export/export.ts <out-dir>
 *
 *  It only reads from production. DATA_README.md next to this file explains every
 *  file and column, and the script copies it into the output folder as README.md. */
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows } from "../../everything-core/paging";
import { noteStatus, type NoteStatus } from "../../everything-core/noteScore";
import { noteTally, probabilityHelpful, type VoteTally } from "../../everything-core/noteBelief";
import type { Vote } from "../../everything-core/votes";
import { stripTrackingParams } from "./urls";
import { toTsv } from "./tsv";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

/** Item bodies are large, so their pages stay small enough to answer quickly. */
const ITEM_PAGE_SIZE = 200;
/** A fresh salt per export. Participant ids are stable inside one export and
 *  cannot be linked to the ids of another export or back to our accounts. */
const PARTICIPANT_SALT = randomBytes(32).toString("hex");
const AI_RATING_SCALE = new Set([
  "certainly true", "likely true", "somewhat likely true", "uncertain",
  "somewhat likely false", "likely false", "certainly false",
]);
const HELPFULNESS_LEVEL: Record<Vote, string> = { 1: "HELPFUL", 0: "SOMEWHAT_HELPFUL", [-1]: "NOT_HELPFUL" };
const X_STATUS: Record<NoteStatus, string> = {
  helpful: "CURRENTLY_RATED_HELPFUL",
  not_helpful: "CURRENTLY_RATED_NOT_HELPFUL",
  needs_ratings: "NEEDS_MORE_RATINGS",
};
const DECIDED_BY = "CommonNotesBetaRule";
const MISLEADING_TAGS = [
  "misleadingOther", "misleadingFactualError", "misleadingManipulatedMedia", "misleadingOutdatedInformation",
  "misleadingMissingImportantContext", "misleadingUnverifiedClaimAsFact", "misleadingSatire",
];
const NOT_MISLEADING_TAGS = [
  "notMisleadingOther", "notMisleadingFactuallyCorrect", "notMisleadingOutdatedButNotWhenWritten",
  "notMisleadingClearlySatire", "notMisleadingPersonalOpinion",
];
const HELPFUL_TAGS = [
  "helpfulOther", "helpfulInformative", "helpfulClear", "helpfulEmpathetic", "helpfulGoodSources",
  "helpfulUniqueContext", "helpfulAddressesClaim", "helpfulImportantContext", "helpfulUnbiasedLanguage",
];
const NOT_HELPFUL_TAGS = [
  "notHelpfulOther", "notHelpfulIncorrect", "notHelpfulSourcesMissingOrUnreliable", "notHelpfulOpinionSpeculationOrBias",
  "notHelpfulMissingKeyPoints", "notHelpfulOutdated", "notHelpfulHardToUnderstand", "notHelpfulArgumentativeOrBiased",
  "notHelpfulOffTopic", "notHelpfulSpamHarassmentOrAbuse", "notHelpfulIrrelevantSources", "notHelpfulOpinionSpeculation",
  "notHelpfulNoteNotNeeded",
];

type WrittenBy = "claude_code" | "pipeline" | "human";
type ParticipantType = "reader" | "team" | "ai_claude_code" | "ai_pipeline";

/** A note or a "note not needed" entry. X stores both as notes and tells them
 *  apart by classification, so this export does the same. */
interface ExportNote {
  id: string;
  claimId: string;
  itemId: string;
  createdAt: string;
  classification: "MISINFORMED_OR_POTENTIALLY_MISLEADING" | "NOT_MISLEADING";
  text: string;
  authorKey: string;
  writtenBy: WrittenBy;
  improvedFromNoteId: string | null;
  hasSources: boolean;
  tallyFields: { helpful_count: number; somewhat_helpful_count: number; not_helpful_count: number; author_id: string | null };
}

interface ExportRating {
  noteId: string;
  voterId: string;
  vote: Vote;
  createdAt: string;
  updatedAt: string | null;
  platform: string | null;
}

interface HistoryRow { target_id: string; voter_id: string; action: string; old_vote: Vote | null; new_vote: Vote | null; at: string }

const millis = (iso: string | null) => (iso === null ? null : new Date(iso).getTime());

function participantId(key: string) {
  return createHash("sha256").update(PARTICIPANT_SALT + key).digest("hex").toUpperCase();
}

function writtenByOf(note: { author_id: string | null; notewriter_id: string | null }): WrittenBy {
  if (note.author_id) return "human";
  if (note.notewriter_id === "pipeline") return "pipeline";
  if (note.notewriter_id?.startsWith("claude-")) return "claude_code";
  throw new Error(`Note without an author or a known notewriter: ${JSON.stringify(note)}`);
}

function claimOrigin(judgement: string | null) {
  if (judgement !== null && AI_RATING_SCALE.has(judgement)) return "pipeline";
  if (judgement === "claude_code" || judgement === "notewriter") return "claude_code";
  if (judgement === "user") return "reader";
  throw new Error(`Unknown claim judgement: ${judgement}`);
}

async function fetchNotes() {
  const notes = await fetchAllRows<{
    id: string; claim_id: string; note: string; created_at: string; author_id: string | null; notewriter_id: string | null;
    improved_from_note_id: string | null; helpful_count: number; somewhat_helpful_count: number; not_helpful_count: number;
  }>(() => db.from("everything_notes")
    .select("id, claim_id, note, created_at, author_id, notewriter_id, improved_from_note_id, helpful_count, somewhat_helpful_count, not_helpful_count")
    // X twins mirror our notes on X. They belong to X's data, not to Common Notes.
    .is("x_note_id", null)
    .neq("status", "hidden"), "id", { label: "notes" });
  const notNeeded = await fetchAllRows<{
    id: string; claim_id: string; body: string; created_at: string; author_id: string;
    helpful_count: number; somewhat_helpful_count: number; not_helpful_count: number;
  }>(() => db.from("everything_note_not_needed")
    .select("id, claim_id, body, created_at, author_id, helpful_count, somewhat_helpful_count, not_helpful_count")
    .eq("status", "published"), "id", { label: "not-needed" });
  return { notes, notNeeded };
}

async function fetchClaims() {
  return fetchAllRows<{
    id: string; item_id: string; created_at: string; claim: string | null; context_quote: string | null; context_paragraph: string | null;
    start_seconds: number | null; end_seconds: number | null; image_urls: string[] | null; judgement: string | null; status: string;
  }>(() => db.from("everything_claims")
    .select("id, item_id, created_at, claim, context_quote, context_paragraph, start_seconds, end_seconds, image_urls, judgement, status"),
  "id", { label: "claims" });
}

async function fetchItems() {
  const projects = await fetchAllRows<{ id: string; name: string; feed_url: string | null }>(
    () => db.from("everything_projects").select("id, name, feed_url"), "id", { label: "projects" });
  const items = await fetchAllRows<{
    id: string; project_id: string; source: string; url: string; title: string | null; published_at: string | null;
    published_time: string | null; first_checked_at: string | null; checked_scope: string | null; skip_reason: string | null; full_text: string | null;
  }>(() => db.from("everything_items")
    .select("id, project_id, source, url, title, published_at, published_time, first_checked_at, checked_scope, skip_reason, full_text"),
  "id", { label: "items", pageSize: ITEM_PAGE_SIZE });
  return { items, projectById: new Map(projects.map((p) => [p.id, p])) };
}

async function fetchRatings(): Promise<ExportRating[]> {
  const votes = await fetchAllRows<{ id: string; note_id: string; voter_id: string; vote: Vote; created_at: string; updated_at: string | null; platform: string | null }>(
    () => db.from("everything_votes").select("id, note_id, voter_id, vote, created_at, updated_at, platform"), "id", { label: "votes" });
  // This table has no single-column key, so it is read whole. It holds a few dozen rows.
  const { data: notNeededVotes, error } = await db.from("everything_note_not_needed_votes").select("entry_id, voter_id, vote, created_at");
  if (error) throw error;
  return [
    ...votes.map((v) => ({ noteId: v.note_id, voterId: v.voter_id, vote: v.vote, createdAt: v.created_at, updatedAt: v.updated_at, platform: v.platform })),
    ...notNeededVotes.map((v) => ({ noteId: v.entry_id, voterId: v.voter_id, vote: v.vote as Vote, createdAt: v.created_at, updatedAt: null, platform: null })),
  ];
}

async function fetchVoteHistory() {
  return fetchAllRows<HistoryRow & { id: number }>(() => db.from("everything_vote_history")
    .select("id, target_id, voter_id, action, old_vote, new_vote, at")
    .in("vote_table", ["everything_votes", "everything_note_not_needed_votes"]), "id", { label: "vote-history" });
}

/** The ids of the team's accounts: the admins, matched to their logins by email. */
async function fetchTeamUserIds() {
  const { data: admins, error } = await db.from("everything_admins").select("email");
  if (error) throw error;
  const adminEmails = new Set(admins.map((a) => a.email.toLowerCase()));
  const teamIds = new Set<string>();
  const USERS_PER_PAGE = 1000;
  for (let page = 1; ; page++) {
    const { data, error: listError } = await db.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
    if (listError) throw listError;
    for (const user of data.users) if (user.email && adminEmails.has(user.email.toLowerCase())) teamIds.add(user.id);
    if (data.users.length < USERS_PER_PAGE) return teamIds;
  }
}

function toExportNotes(raw: Awaited<ReturnType<typeof fetchNotes>>, itemIdOfClaim: Map<string, string>, noteIdsWithSources: Set<string>): ExportNote[] {
  const notes: ExportNote[] = raw.notes.map((n) => {
    const writtenBy = writtenByOf(n);
    return {
      id: n.id, claimId: n.claim_id, itemId: itemIdOfClaim.get(n.claim_id)!, createdAt: n.created_at,
      classification: "MISINFORMED_OR_POTENTIALLY_MISLEADING", text: n.note,
      authorKey: n.author_id ?? `ai:${writtenBy}`, writtenBy, improvedFromNoteId: n.improved_from_note_id,
      // Early notes carry their links in the text instead of as source rows.
      hasSources: noteIdsWithSources.has(n.id) || n.note.includes("http"), tallyFields: n,
    };
  });
  const notNeeded: ExportNote[] = raw.notNeeded.map((n) => ({
    id: n.id, claimId: n.claim_id, itemId: itemIdOfClaim.get(n.claim_id)!, createdAt: n.created_at,
    classification: "NOT_MISLEADING", text: n.body, authorKey: n.author_id, writtenBy: "human",
    improvedFromNoteId: null, hasSources: false, tallyFields: n,
  }));
  return [...notes, ...notNeeded];
}

/** One rater's vote over time on one note: null means no vote at that moment. */
type VoteEvent = { at: number; voterId: string; vote: Vote | null };

/** Rebuilds when each vote was cast, changed and retracted. The history table
 *  starts on 2026-10-06. A vote older than that, and never touched since, counts
 *  as cast with its current value at its creation time. A vote that was changed
 *  or retracted after that date starts with its old value at its creation time,
 *  or at the note's creation time when the vote row is gone. Changes before
 *  2026-10-06 are lost. */
function voteEvents(note: ExportNote, ratings: ExportRating[], history: HistoryRow[]): VoteEvent[] {
  const historyByVoter = Map.groupBy(history, (h) => h.voter_id);
  const ratingByVoter = new Map(ratings.map((r) => [r.voterId, r]));
  const events: VoteEvent[] = [];
  for (const voterId of new Set([...historyByVoter.keys(), ...ratingByVoter.keys()])) {
    const rows = (historyByVoter.get(voterId) ?? []).toSorted((a, b) => a.at.localeCompare(b.at));
    const rating = ratingByVoter.get(voterId);
    const first = rows[0];
    if (!first) {
      events.push({ at: millis(rating!.createdAt)!, voterId, vote: rating!.vote });
      continue;
    }
    if (first.action !== "cast") events.push({ at: millis(rating?.createdAt ?? note.createdAt)!, voterId, vote: first.old_vote });
    for (const row of rows) {
      const isRemoval = row.action === "retracted" || row.action === "cascaded";
      events.push({ at: millis(row.at)!, voterId, vote: isRemoval ? null : row.new_vote });
    }
  }
  return events.toSorted((a, b) => a.at - b.at);
}

function tallyOf(votes: Map<string, Vote | null>): VoteTally {
  const values = [...votes.values()];
  return {
    helpful: values.filter((v) => v === 1).length,
    somewhatHelpful: values.filter((v) => v === 0).length,
    notHelpful: values.filter((v) => v === -1).length,
  };
}

/** Replays a note's votes and returns every moment its status changed. */
function statusChanges(note: ExportNote, events: VoteEvent[]) {
  const current = new Map<string, Vote | null>();
  const changes: { at: number; status: NoteStatus }[] = [];
  let status: NoteStatus = "needs_ratings";
  for (const event of events) {
    current.set(event.voterId, event.vote);
    const tally = tallyOf(current);
    const next = noteStatus({
      helpful_count: tally.helpful, somewhat_helpful_count: tally.somewhatHelpful,
      not_helpful_count: tally.notHelpful, author_id: note.tallyFields.author_id,
    });
    if (next !== status) changes.push({ at: event.at, status: next });
    status = next;
  }
  return { changes, finalTally: tallyOf(current) };
}

function statusHistoryRow(note: ExportNote, ratings: ExportRating[], history: HistoryRow[], exportMinute: number) {
  const { changes, finalTally } = statusChanges(note, voteEvents(note, ratings, history));
  const stored = note.tallyFields;
  if (finalTally.helpful !== stored.helpful_count || finalTally.somewhatHelpful !== stored.somewhat_helpful_count || finalTally.notHelpful !== stored.not_helpful_count) {
    throw new Error(`Replayed votes of ${note.id} do not add up to its stored counts: ${JSON.stringify({ finalTally, stored })}`);
  }
  const currentStatus = noteStatus(stored);
  const nonNmr = changes.filter((c) => c.status !== "needs_ratings");
  const firstNonNmr = nonNmr[0];
  const latestNonNmr = nonNmr.at(-1);
  const lastChange = changes.at(-1);
  return {
    noteId: note.id,
    noteAuthorParticipantId: participantId(note.authorKey),
    createdAtMillis: millis(note.createdAt),
    timestampMillisOfFirstNonNMRStatus: firstNonNmr?.at,
    firstNonNMRStatus: firstNonNmr && X_STATUS[firstNonNmr.status],
    timestampMillisOfCurrentStatus: lastChange?.at ?? millis(note.createdAt),
    currentStatus: X_STATUS[currentStatus],
    timestampMillisOfLatestNonNMRStatus: latestNonNmr?.at,
    mostRecentNonNMRStatus: latestNonNmr && X_STATUS[latestNonNmr.status],
    timestampMillisOfStatusLock: null,
    lockedStatus: null,
    timestampMillisOfRetroLock: null,
    currentCoreStatus: null,
    currentExpansionStatus: null,
    currentGroupStatus: null,
    currentDecidedBy: DECIDED_BY,
    currentModelingGroup: null,
    timestampMillisOfMostRecentStatusChange: lastChange?.at,
    timestampMillisOfNmrDueToMinStableCrhTime: null,
    currentMultiGroupStatus: null,
    currentModelingMultiGroup: null,
    timestampMinuteOfFinalScoringOutput: exportMinute,
    timestampMillisOfFirstNmrDueToMinStableCrhTime: null,
    timestampMillisAbovePcrhThreshold: null,
    pHelpful: probabilityHelpful(noteTally(stored)),
  };
}

function noteRow(note: ExportNote) {
  const isMisleading = note.classification === "MISINFORMED_OR_POTENTIALLY_MISLEADING";
  return {
    noteId: note.id,
    noteAuthorParticipantId: participantId(note.authorKey),
    createdAtMillis: millis(note.createdAt),
    itemId: note.itemId,
    classification: note.classification,
    believable: null,
    harmful: null,
    validationDifficulty: null,
    ...Object.fromEntries(MISLEADING_TAGS.map((tag) => [tag, isMisleading ? 0 : null])),
    ...Object.fromEntries(NOT_MISLEADING_TAGS.map((tag) => [tag, isMisleading ? null : 0])),
    trustworthySources: note.hasSources ? 1 : 0,
    summary: note.text,
    isMediaNote: 0,
    isCollaborativeNote: 0,
    claimId: note.claimId,
    writtenBy: note.writtenBy,
    improvedFromNoteId: note.improvedFromNoteId,
  };
}

function ratingRow(rating: ExportRating, itemId: string) {
  return {
    noteId: rating.noteId,
    raterParticipantId: participantId(rating.voterId),
    createdAtMillis: millis(rating.createdAt),
    version: 2,
    agree: 0,
    disagree: 0,
    helpful: 0,
    notHelpful: 0,
    helpfulnessLevel: HELPFULNESS_LEVEL[rating.vote],
    ...Object.fromEntries(HELPFUL_TAGS.map((tag) => [tag, 0])),
    ...Object.fromEntries(NOT_HELPFUL_TAGS.map((tag) => [tag, 0])),
    ratedOnItemId: itemId,
    ratingSourceBucketed: "DEFAULT",
    suggestion: null,
    suggestionId: null,
    updatedAtMillis: millis(rating.updatedAt),
    platform: rating.platform,
  };
}

/** One row per participant. Nobody on Common Notes has to earn the right to rate
 *  or write, so every participant counts as earned in from their first action. */
function enrollmentRows(notes: ExportNote[], ratings: ExportRating[], teamIds: Set<string>) {
  const firstActionAt = new Map<string, number>();
  const typeOf = new Map<string, ParticipantType>();
  const record = (key: string, at: number, type: ParticipantType) => {
    firstActionAt.set(key, Math.min(firstActionAt.get(key) ?? at, at));
    typeOf.set(key, type);
  };
  const humanType = (userId: string): ParticipantType => (teamIds.has(userId) ? "team" : "reader");
  for (const n of notes) record(n.authorKey, millis(n.createdAt)!, n.writtenBy === "human" ? humanType(n.authorKey) : `ai_${n.writtenBy}`);
  for (const r of ratings) record(r.voterId, millis(r.createdAt)!, humanType(r.voterId));
  return [...firstActionAt].map(([key, at]) => ({
    participantId: participantId(key),
    enrollmentState: "earnedIn",
    successfulRatingNeededToEarnIn: 0,
    timestampOfLastStateChange: at,
    timestampOfLastEarnOut: null,
    modelingPopulation: null,
    modelingGroup: null,
    numberOfTimesEarnedOut: 0,
    participantType: typeOf.get(key),
  }));
}

function itemRow(item: Awaited<ReturnType<typeof fetchItems>>["items"][number], project: { name: string; feed_url: string | null }) {
  return {
    itemId: item.id,
    source: item.source,
    url: stripTrackingParams(item.url),
    title: item.title,
    creatorName: project.name,
    creatorFeedUrl: project.feed_url,
    publishedDate: item.published_at,
    publishedAtMillis: millis(item.published_time),
    firstCheckedAtMillis: millis(item.first_checked_at),
    checkedScope: item.checked_scope,
    skipReason: item.skip_reason,
    text: item.full_text,
  };
}

function claimRow(claim: Awaited<ReturnType<typeof fetchClaims>>[number]) {
  return {
    claimId: claim.id,
    itemId: claim.item_id,
    createdAtMillis: millis(claim.created_at),
    origin: claimOrigin(claim.judgement),
    claim: claim.claim,
    passage: claim.context_quote,
    contextParagraph: claim.context_paragraph,
    startSeconds: claim.start_seconds,
    endSeconds: claim.end_seconds,
    imageUrls: claim.image_urls?.length ? JSON.stringify(claim.image_urls) : null,
    aiRating: claim.judgement !== null && AI_RATING_SCALE.has(claim.judgement) ? claim.judgement : null,
    checkStatus: claim.status,
  };
}

const isLocalUrl = (url: string) => ["localhost", "127.0.0.1"].includes(new URL(url).hostname);

async function main() {
  const outDir = process.argv[2];
  if (!outDir) throw new Error("Usage: export.ts <out-dir>");
  mkdirSync(outDir, { recursive: true });
  const exportMinute = Math.floor(Date.now() / 60_000);

  const [rawNotes, claims, { items, projectById }, ratings, history, teamIds, sources] = await Promise.all([
    fetchNotes(), fetchClaims(), fetchItems(), fetchRatings(), fetchVoteHistory(), fetchTeamUserIds(),
    fetchAllRows<{ id: string; note_id: string; sort_order: number; url: string; quote: string | null; explanation: string | null }>(
      () => db.from("everything_note_sources").select("id, note_id, sort_order, url, quote, explanation"), "id", { label: "sources" }),
  ]);

  const itemIdOfClaim = new Map(claims.map((c) => [c.id, c.item_id]));
  const notes = toExportNotes(rawNotes, itemIdOfClaim, new Set(sources.map((s) => s.note_id)));
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const exportedRatings = ratings.filter((r) => noteById.has(r.noteId));
  const itemIdsWithNotes = new Set(notes.map((n) => n.itemId));
  const exportedItems = items.filter((i) => (itemIdsWithNotes.has(i.id) || i.first_checked_at !== null) && !isLocalUrl(i.url));
  const exportedItemIds = new Set(exportedItems.map((i) => i.id));
  const exportedNotes = notes.filter((n) => exportedItemIds.has(n.itemId));
  const exportedNoteIds = new Set(exportedNotes.map((n) => n.id));

  const ratingsByNote = Map.groupBy(exportedRatings, (r) => r.noteId);
  const historyByNote = Map.groupBy(history.filter((h) => noteById.has(h.target_id)), (h) => h.target_id);
  const byCreatedAt = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt);

  const files: Record<string, Record<string, unknown>[]> = {
    "notes-00000.tsv": exportedNotes.toSorted(byCreatedAt).map(noteRow),
    "ratings-00000.tsv": exportedRatings.filter((r) => exportedNoteIds.has(r.noteId)).toSorted(byCreatedAt)
      .map((r) => ratingRow(r, noteById.get(r.noteId)!.itemId)),
    "noteStatusHistory-00000.tsv": exportedNotes.toSorted(byCreatedAt)
      .map((n) => statusHistoryRow(n, ratingsByNote.get(n.id) ?? [], historyByNote.get(n.id) ?? [], exportMinute)),
    "userEnrollment-00000.tsv": enrollmentRows(exportedNotes, exportedRatings, teamIds),
    "noteSources-00000.tsv": sources.filter((s) => exportedNoteIds.has(s.note_id))
      .toSorted((a, b) => a.note_id.localeCompare(b.note_id) || a.sort_order - b.sort_order)
      .map((s) => ({ noteId: s.note_id, sortOrder: s.sort_order, url: stripTrackingParams(s.url), quote: s.quote, explanation: s.explanation })),
    "items-00000.tsv": exportedItems.map((i) => itemRow(i, projectById.get(i.project_id)!)),
    "claims-00000.tsv": claims.filter((c) => exportedItemIds.has(c.item_id)).toSorted((a, b) => a.created_at.localeCompare(b.created_at)).map(claimRow),
  };
  for (const [name, rows] of Object.entries(files)) {
    writeFileSync(join(outDir, name), toTsv(rows));
    console.log(`${name}: ${rows.length} rows`);
  }
  copyFileSync(join(import.meta.dir, "DATA_README.md"), join(outDir, "README.md"));
}

await main();
