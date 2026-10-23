import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { NnnRow, NoteRow } from "@cn/core/types";
import { queryKeys } from "../query/queryKeys";

/** The notes one surface shows, with the note-not-needed entries on their
 *  claims, keyed by id. The extension caches one per page. Each page of a
 *  paged list of notes on the website is one too. They are all cached under
 *  the `noteSet` key prefix, which is how a vote anywhere updates the note
 *  everywhere it is shown. */
export interface NoteSet {
  notes: Map<string, NoteRow>;
  nnn: Map<string, NnnRow>;
}

export const noteSetOf = (notes: NoteRow[], nnn: NnnRow[]): NoteSet => ({
  notes: new Map(notes.map((n) => [n.id, n])),
  nnn: new Map(nnn.map((e) => [e.id, e])),
});

/** A cached entry under the `noteSet` prefix: one NoteSet, or the pages of a
 *  paged list, each of which is a NoteSet with more fields of its own. */
type CachedNoteSets = NoteSet | InfiniteData<NoteSet>;

/** Applies `update` to every cached NoteSet, including each page of a paged
 *  list. The rest of a page is kept as it was. */
function updateEveryNoteSet(client: QueryClient, update: (set: NoteSet) => NoteSet) {
  client.setQueriesData<CachedNoteSets>({ queryKey: queryKeys.noteSets }, (cached) => {
    if (!cached) return cached;
    return "pages" in cached ? { ...cached, pages: cached.pages.map(update) } : update(cached);
  });
}

/** Changes the fields of a note in every cached NoteSet that shows it. A
 *  NoteSet that does not hold the note is left alone. The note keeps the claim
 *  object it already had, so the claim's identity stays stable for anything
 *  keyed on it. */
export function patchNoteInNoteSets(client: QueryClient, noteId: string, fields: Partial<NoteRow>) {
  updateEveryNoteSet(client, (set) => {
    const existing = set.notes.get(noteId);
    if (!existing) return set;
    return { ...set, notes: new Map(set.notes).set(noteId, { ...existing, ...fields, claim: existing.claim }) };
  });
}

/** Puts a changed note into every cached NoteSet that shows it. */
export const updateNoteInNoteSets = (client: QueryClient, note: NoteRow) => patchNoteInNoteSets(client, note.id, note);

/** Takes a deleted note out of every cached NoteSet. */
export function removeNoteFromNoteSets(client: QueryClient, noteId: string) {
  updateEveryNoteSet(client, (set) => {
    if (!set.notes.has(noteId)) return set;
    const notes = new Map(set.notes);
    notes.delete(noteId);
    return { ...set, notes };
  });
}

/** Puts a new or changed entry into every cached NoteSet that shows a note on
 *  its claim. An entry renders under the notes on its claim, so a NoteSet
 *  without such a note has nowhere to show it. */
export function upsertNnnInNoteSets(client: QueryClient, entry: NnnRow) {
  updateEveryNoteSet(client, (set) =>
    [...set.notes.values()].some((note) => note.claim_id === entry.claim_id) ? { ...set, nnn: new Map(set.nnn).set(entry.id, entry) } : set,
  );
}

/** Takes a deleted entry out of every cached NoteSet. */
export function removeNnnFromNoteSets(client: QueryClient, entryId: string) {
  updateEveryNoteSet(client, (set) => {
    if (!set.nnn.has(entryId)) return set;
    const nnn = new Map(set.nnn);
    nnn.delete(entryId);
    return { ...set, nnn };
  });
}
