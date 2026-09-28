import type { QueryClient } from "@tanstack/react-query";
import type { NnnRow, NoteRow } from "@cn/core/types";
import { queryKeys } from "../query/queryKeys";

/** The notes one surface shows, with the note-not-needed entries on their
 *  claims, keyed by id. The website caches one per project and the extension
 *  one per page. Both are cached under the `noteSet` key prefix, which is how
 *  a vote anywhere updates the note everywhere it is shown. */
export interface NoteSet {
  notes: Map<string, NoteRow>;
  nnn: Map<string, NnnRow>;
}

export const noteSetOf = (notes: NoteRow[], nnn: NnnRow[]): NoteSet => ({
  notes: new Map(notes.map((n) => [n.id, n])),
  nnn: new Map(nnn.map((e) => [e.id, e])),
});

/** Puts a changed note into every cached NoteSet that shows it. A NoteSet that
 *  does not hold the note is left alone. The note keeps the claim object it
 *  already had, so the claim's identity stays stable for anything keyed on
 *  it. */
export function updateNoteInNoteSets(client: QueryClient, note: NoteRow) {
  client.setQueriesData<NoteSet>({ queryKey: queryKeys.noteSets }, (set) => {
    const existing = set?.notes.get(note.id);
    if (!set || !existing) return set;
    return { ...set, notes: new Map(set.notes).set(note.id, { ...note, claim: existing.claim }) };
  });
}

/** Puts a changed note-not-needed entry into every cached NoteSet that shows
 *  it. */
export function updateNnnInNoteSets(client: QueryClient, entry: NnnRow) {
  client.setQueriesData<NoteSet>({ queryKey: queryKeys.noteSets }, (set) =>
    set?.nnn.has(entry.id) ? { ...set, nnn: new Map(set.nnn).set(entry.id, entry) } : set,
  );
}
