import { fetchAllRows } from "./paging";
import { supabase } from "./supabase";

/* The admins' curation of the best notes (migrations 132 and 133). Claude
 * keeps a ranked list of recommendations, and the admins build their own
 * leaderboard from it. Moving a note to the leaderboard or removing it from
 * the recommendations is recorded on the recommendation's row, so the reasons
 * stay readable. Both lists are ordered by `position`, smallest first, and a
 * move writes only the moved note's row: its new position lies between the
 * positions of its new neighbours. Only admins can read or change either list. */

/** Which of the two lists. */
export type CurationList = "recommendations" | "leaderboard";

/** The admin page's sections: the two lists, and the removed recommendations. */
export const CURATION_SECTIONS = ["recommendations", "leaderboard", "removed"] as const;
export type CurationSection = (typeof CURATION_SECTIONS)[number];

/** One note on a list. `comment` is an admin's note on why it sits where it
 *  does. `posted_at` says when an admin marked a leaderboard note as posted on
 *  X; it is always null for a recommendation. */
export interface CuratedNoteRow {
  note_id: string;
  position: number;
  comment: string | null;
  posted_at: string | null;
}

/** What the position helpers need of a row: which note, and where it sits. */
type Positioned = Pick<CuratedNoteRow, "note_id" | "position">;

/** A recommendation an admin removed, with the reason they gave. */
export interface RemovedRecommendation {
  note_id: string;
  removed_at: string;
  removed_reason: string | null;
}

const TABLE: Record<CurationList, "everything_note_recommendations" | "everything_best_notes"> = {
  recommendations: "everything_note_recommendations",
  leaderboard: "everything_best_notes",
};

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
export function positionAfterMove(list: Positioned[], movedId: string, above: string | undefined, below: string | undefined): number {
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

/** The position that puts a note at the given rank (1 is the top) of a list
 *  that does not contain it. A rank past the end means the end. */
export function positionAtRank(list: Positioned[], rank: number): number {
  const index = Math.min(Math.max(rank - 1, 0), list.length);
  return positionBetween(list[index - 1]?.position, list[index]?.position);
}

/** One list, best note first. Recommendations that were moved or removed are
 *  left out. */
export async function fetchCuratedList(list: CurationList): Promise<CuratedNoteRow[]> {
  const rows =
    list === "leaderboard"
      ? await fetchAllRows<CuratedNoteRow>(() => supabase.from(TABLE.leaderboard).select("note_id, position, comment, posted_at"), "note_id", { label: list })
      : (
          await fetchAllRows<Omit<CuratedNoteRow, "posted_at">>(
            () => supabase.from(TABLE.recommendations).select("note_id, position, comment").is("moved_at", null).is("removed_at", null),
            "note_id",
            { label: list },
          )
        ).map((row) => ({ ...row, posted_at: null }));
  return rows.sort((a, b) => a.position - b.position);
}

/** The recommendations admins removed, the most recent first. */
export async function fetchRemovedRecommendations(): Promise<RemovedRecommendation[]> {
  const rows = await fetchAllRows<RemovedRecommendation>(
    () => supabase.from("everything_note_recommendations").select("note_id, removed_at, removed_reason").not("removed_at", "is", null),
    "note_id",
    { label: "removedRecommendations" },
  );
  return rows.sort((a, b) => b.removed_at.localeCompare(a.removed_at));
}

/** Writes one row's changed columns, and fails loudly when the database let
 *  nothing through, which is what a non-admin gets. */
async function updateRow(list: CurationList, noteId: string, change: Record<string, unknown>, what: string) {
  const { data, error } = await supabase.from(TABLE[list]).update(change).eq("note_id", noteId).select("note_id");
  if (error) throw new Error(`could not ${what}: ${error.message}`);
  if (data.length === 0) throw new Error(`could not ${what}: only admins may change the list`);
}

export const setPosition = (list: CurationList, noteId: string, position: number) => updateRow(list, noteId, { position }, "move the note");

export const setComment = (list: CurationList, noteId: string, comment: string) =>
  updateRow(list, noteId, { comment: comment.trim() || null }, "save the comment");

/** Marks a leaderboard note as posted on X, or takes the mark off. */
export const setPosted = (noteId: string, posted: boolean) =>
  updateRow("leaderboard", noteId, { posted_at: posted ? new Date().toISOString() : null }, "change the posted mark");

export const removeRecommendation = (noteId: string, reason: string) =>
  updateRow("recommendations", noteId, { removed_at: new Date().toISOString(), removed_reason: reason.trim() || null }, "remove the note");

export const restoreRecommendation = (noteId: string) =>
  updateRow("recommendations", noteId, { removed_at: null, removed_reason: null }, "restore the note");

/** Moves a recommendation to the leaderboard at the given position. */
export async function moveToLeaderboard(noteId: string, position: number): Promise<void> {
  const { error } = await supabase.rpc("everything_move_to_leaderboard", { p_note_id: noteId, p_position: position });
  if (error) throw new Error(`could not move the note to the leaderboard: ${error.message}`);
}

/** Takes a note off the leaderboard and makes it a recommendation again. */
export async function returnToRecommendations(noteId: string): Promise<void> {
  const { error } = await supabase.rpc("everything_return_to_recommendations", { p_note_id: noteId });
  if (error) throw new Error(`could not take the note off the leaderboard: ${error.message}`);
}
