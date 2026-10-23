/**
 * Reads and changes Claude's recommendations of the best notes (GOO-555), for
 * the daily postable-notes job. Admins build their own leaderboard from these
 * on commonnotes.net/admin/best.
 *
 *   bun run recommend-notes list                       # the open recommendations, best first, with each note's rank
 *   bun run recommend-notes add <noteId>... [--at N]   # recommend notes at rank N (default: the end), in the given order
 *   bun run recommend-notes move <noteId> --at N       # move a recommendation to rank N
 *
 * Ranks count from 1. A note an admin already moved to the leaderboard or
 * removed is left as it is, because that was their call. It writes the
 * production database through SUPABASE_URL and SUPABASE_SERVICE_KEY.
 */

import "dotenv/config";
import { getSupabaseClient } from "../api/supabaseClient";
import { positionsBetween, type CuratedNoteRow } from "../everything-core/bestNotes";
import { fetchAllRows, fetchInBatches } from "../everything-core/paging";

const NOTE_PREVIEW_LENGTH = 110;
const db = getSupabaseClient();

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

type RecommendationRow = CuratedNoteRow & { moved_at: string | null; removed_at: string | null };

async function fetchRecommendations(): Promise<RecommendationRow[]> {
  const rows = await fetchAllRows<RecommendationRow>(
    () => db.from("everything_note_recommendations").select("note_id, position, comment, moved_at, removed_at"),
    "note_id",
  );
  return rows.sort((a, b) => a.position - b.position);
}

const isOpen = (row: RecommendationRow) => !row.moved_at && !row.removed_at;

/** The rank argument as an index into the list without the notes being
 *  placed. A rank past the end means the end. */
function insertIndex(list: CuratedNoteRow[]): number {
  const rank = readFlag("--at");
  if (rank === undefined) return list.length;
  const index = Number(rank) - 1;
  if (!Number.isInteger(index) || index < 0) throw new Error(`--at needs a rank of 1 or more, not ${rank}`);
  return Math.min(index, list.length);
}

/** Places the notes one after another at the requested rank. Notes already on
 *  the list are moved there. */
async function place(requested: string[]) {
  const all = await fetchRecommendations();
  const curated = new Set(all.filter((row) => !isOpen(row)).map((row) => row.note_id));
  const noteIds = requested.filter((noteId) => !curated.has(noteId));
  if (noteIds.length < requested.length) console.log(`Left out ${requested.length - noteIds.length} notes that admins already moved or removed.`);
  const others = all.filter((row) => isOpen(row) && !noteIds.includes(row.note_id));
  const index = insertIndex(others);
  const positions = positionsBetween(others[index - 1]?.position, others[index]?.position, noteIds.length);
  const placed = noteIds.map((noteId, i) => ({ note_id: noteId, position: positions[i] }));
  const { error } = await db.from("everything_note_recommendations").upsert(placed);
  if (error) throw error;
  console.log(`Placed ${placed.length} notes at rank ${index + 1}.`);
}

async function list() {
  const rows = (await fetchRecommendations()).filter(isOpen);
  type Note = { id: string; note: string; claim: { item: { title: string | null; project: { name: string } | null } } };
  const notes = await fetchInBatches<Note>(
    (ids) => db.from("everything_notes").select("id, note, claim:everything_claims!inner(item:everything_items!inner(title, project:everything_projects(name)))").in("id", ids),
    rows.map((row) => row.note_id),
    "id",
  );
  const byId = new Map(notes.map((note) => [note.id, note]));
  rows.forEach((row, i) => {
    const note = byId.get(row.note_id);
    const where = note ? `${note.claim.item.project?.name ?? "?"} | ${note.claim.item.title ?? "Untitled"}` : "(note not found)";
    console.log(`${i + 1}. ${row.note_id} ${where}\n   ${note?.note.slice(0, NOTE_PREVIEW_LENGTH) ?? ""}`);
  });
}

const [command, ...rest] = process.argv.slice(2);
const noteIds = rest.filter((arg, i) => !arg.startsWith("--") && !rest[i - 1]?.startsWith("--"));
if (command === "list") await list();
else if (command === "add" && noteIds.length > 0) await place(noteIds);
else if (command === "move" && noteIds.length === 1 && readFlag("--at")) await place(noteIds);
else {
  console.error("usage: recommend-notes list | add <noteId>... [--at N] | move <noteId> --at N");
  process.exit(1);
}
