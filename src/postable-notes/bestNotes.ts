/**
 * Reads and changes the best notes list on commonnotes.net/notes/best
 * (GOO-526), for the daily postable-notes job.
 *
 *   bun run best-notes list                       # the list, best first, with each note's rank
 *   bun run best-notes add <noteId>... [--at N]   # put notes on the list at rank N (default: the end), in the given order
 *   bun run best-notes move <noteId> --at N       # move a note on the list to rank N
 *
 * Ranks count from 1. It writes the production database through SUPABASE_URL
 * and SUPABASE_SERVICE_KEY. Taking a note off the list is left to admins on
 * the website.
 */

import "dotenv/config";
import { getSupabaseClient } from "../api/supabaseClient";
import { positionsBetween, type BestNoteRow } from "../everything-core/bestNotes";
import { fetchAllRows, fetchInBatches } from "../everything-core/paging";

const NOTE_PREVIEW_LENGTH = 110;
const db = getSupabaseClient();

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function fetchList(): Promise<BestNoteRow[]> {
  const rows = await fetchAllRows<BestNoteRow>(() => db.from("everything_best_notes").select("note_id, position"), "note_id");
  return rows.sort((a, b) => a.position - b.position);
}

/** The rank argument as an index into the list without the notes being
 *  placed. A rank past the end means the end. */
function insertIndex(list: BestNoteRow[]): number {
  const rank = readFlag("--at");
  if (rank === undefined) return list.length;
  const index = Number(rank) - 1;
  if (!Number.isInteger(index) || index < 0) throw new Error(`--at needs a rank of 1 or more, not ${rank}`);
  return Math.min(index, list.length);
}

/** Places the notes one after another at the requested rank. Notes already on
 *  the list are moved there. */
async function place(noteIds: string[]) {
  const others = (await fetchList()).filter((row) => !noteIds.includes(row.note_id));
  const index = insertIndex(others);
  const positions = positionsBetween(others[index - 1]?.position, others[index]?.position, noteIds.length);
  const placed = noteIds.map((noteId, i) => ({ note_id: noteId, position: positions[i] }));
  const { error } = await db.from("everything_best_notes").upsert(placed);
  if (error) throw error;
  console.log(`Placed ${placed.length} notes at rank ${index + 1}.`);
}

async function list() {
  const rows = await fetchList();
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
  console.error("usage: best-notes list | add <noteId>... [--at N] | move <noteId> --at N");
  process.exit(1);
}
