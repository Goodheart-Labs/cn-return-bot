import { fetchAllRows } from "./paging";
import { supabase } from "./supabase";

/* The best notes list on /notes/best (migration 132). Each row puts one note
 * on the list. The list is ordered by `position`, smallest first. A move
 * writes only the moved note's row: its new position lies between the
 * positions of its new neighbours. */

export interface BestNoteRow {
  note_id: string;
  position: number;
}

/** The positions for `count` notes placed in a row between two neighbours,
 *  evenly spaced. A missing neighbour means the notes go to that end of the
 *  list, one apart. */
export function positionsBetween(before: number | undefined, after: number | undefined, count: number): number[] {
  const steps = Array.from({ length: count }, (_, i) => i);
  if (before !== undefined && after !== undefined) return steps.map((i) => before + ((after - before) * (i + 1)) / (count + 1));
  if (before !== undefined) return steps.map((i) => before + i + 1);
  if (after !== undefined) return steps.map((i) => after - count + i);
  return steps;
}

/** The position for one note placed between two neighbours, the same as
 *  positionsBetween with a count of one. */
export function positionBetween(before: number | undefined, after: number | undefined): number {
  if (before !== undefined && after !== undefined) return (before + after) / 2;
  if (before !== undefined) return before + 1;
  if (after !== undefined) return after - 1;
  return 0;
}

/** The position that puts a moved note right below the note now shown above
 *  it, or right above the note shown below it when it went to the top of what
 *  is shown. In a list narrowed to one creator the notes of other creators
 *  between them keep their places. `list` is the whole list, best first. */
export function positionAfterMove(list: BestNoteRow[], movedId: string, above: string | undefined, below: string | undefined): number {
  const others = list.filter((row) => row.note_id !== movedId);
  const indexOf = (noteId: string) => others.findIndex((row) => row.note_id === noteId);
  if (above !== undefined) {
    const i = indexOf(above);
    return positionBetween(others[i]?.position, others[i + 1]?.position);
  }
  if (below !== undefined) {
    const i = indexOf(below);
    return positionBetween(others[i - 1]?.position, others[i]?.position);
  }
  return positionBetween(undefined, undefined);
}

/** The whole list, best note first. */
export async function fetchBestNotes(): Promise<BestNoteRow[]> {
  const rows = await fetchAllRows<BestNoteRow>(() => supabase.from("everything_best_notes").select("note_id, position"), "note_id", {
    label: "bestNotes",
  });
  return rows.sort((a, b) => a.position - b.position);
}

/** Moves a note to a new position. Only admins may (migration 132). */
export async function moveBestNote(noteId: string, position: number): Promise<void> {
  const { data, error } = await supabase.from("everything_best_notes").update({ position }).eq("note_id", noteId).select("note_id");
  if (error) throw new Error(`could not move the note: ${error.message}`);
  if (data.length === 0) throw new Error("could not move the note: only admins may change the list");
}

/** Takes a note off the list. The note itself stays on the site. */
export async function removeBestNote(noteId: string): Promise<void> {
  const { data, error } = await supabase.from("everything_best_notes").delete().eq("note_id", noteId).select("note_id");
  if (error) throw new Error(`could not take the note off the list: ${error.message}`);
  if (data.length === 0) throw new Error("could not take the note off the list: only admins may change the list");
}
