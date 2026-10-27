import { fetchAllRows } from "./paging";
import { supabase } from "./supabase";
import type { ProjectHeader } from "./types";

/* The admins' leaderboard of the best notes (migrations 136 to 138). Admins
 * add a note from the review page, at the bottom, and order the list by hand.
 * It is ordered by `position`, smallest first, and a move writes only the
 * moved note's row: its new position lies between the positions of its new
 * neighbours. Only admins can read or change it.
 *
 * Until GOO-597 (2026-10-27) the daily postable-notes job also kept a ranked
 * list of recommendations, everything_note_recommendations, which the admins
 * picked leaderboard notes from. The table keeps its rows, and
 * `bun run curation-taste` still reads the removed ones. */

/** The database's name for the leaderboard among the curation sections of
 *  migration 141. */
const LEADERBOARD = "leaderboard";

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

/** One note of the leaderboard as the page shows it. It may have a comment
 *  and may have been posted on X. `sort_key` is the list's order, which the
 *  next page starts after. */
export interface CurationRow {
  note_id: string;
  sort_key: number;
  position: number | null;
  comment: string | null;
  posted_at: string | null;
}

/** How the leaderboard is narrowed: to one creator, to notes not yet posted
 *  on X, or to notes the admin had not voted on before `votedBefore`. */
export interface CurationFilters {
  projectSlug: string | null;
  notPostedOnly: boolean;
  unvotedOnly: boolean;
  votedBefore: Date;
}

/** How many notes one page of the leaderboard holds. */
export const CURATION_PAGE_SIZE = 30;

const TABLE = "everything_best_notes";

/** The position for one note placed between two neighbours. A missing
 *  neighbour means the note goes to that end of the list. */
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

/** Puts a note at the bottom of the leaderboard. */
export async function addToLeaderboard(noteId: string): Promise<void> {
  const { data, error } = await supabase.from(TABLE).select("position").order("position", { ascending: false }).limit(1);
  if (error) throw new Error(`could not read the leaderboard: ${error.message}`);
  const { error: insertError } = await supabase.from(TABLE).insert({ note_id: noteId, position: positionBetween(data[0]?.position, undefined) });
  if (insertError) throw new Error(`could not add the note to the leaderboard: ${insertError.message}`);
}

/** Takes a note off the leaderboard. */
export async function removeFromLeaderboard(noteId: string): Promise<void> {
  const { data, error } = await supabase.from(TABLE).delete().eq("note_id", noteId).select("note_id");
  if (error) throw new Error(`could not take the note off the leaderboard: ${error.message}`);
  if (data.length === 0) throw new Error("could not take the note off the leaderboard: only admins may change it");
}

/** The whole leaderboard, best note first. Only the reorder mode reads it, to
 *  let an admin drag a note to any place. */
export async function fetchLeaderboard(): Promise<CuratedNoteRow[]> {
  const rows = await fetchAllRows<CuratedNoteRow>(() => supabase.from(TABLE).select("note_id, position, comment, posted_at"), "note_id", { label: "leaderboard" });
  return rows.sort((a, b) => a.position - b.position);
}

/** One page of the leaderboard, starting after the row `after` (migration
 *  141). A note that was deleted or hidden is left out. */
export async function fetchCurationPage(filters: CurationFilters, after: CurationRow | null): Promise<CurationRow[]> {
  const { data, error } = await supabase.rpc("everything_curation_page", {
    p_section: LEADERBOARD,
    p_project_slug: filters.projectSlug ?? undefined,
    p_not_posted_only: filters.notPostedOnly,
    p_unvoted_only: filters.unvotedOnly,
    p_voted_before: filters.votedBefore.toISOString(),
    p_after_key: after?.sort_key,
    p_after_note_id: after?.note_id,
    p_limit: CURATION_PAGE_SIZE,
  });
  if (error) throw new Error(`could not load the curation: ${error.message}`);
  return data;
}

/** A creator with notes on the leaderboard, and how many. */
export type CurationCreator = ProjectHeader & { count: number };

/** What the leaderboard's sidebar shows: how many notes it holds, and its
 *  creators, the most notes first. */
export interface CurationSummary {
  count: number;
  creators: CurationCreator[];
}

export async function fetchCurationSummary(): Promise<CurationSummary> {
  const { data, error } = await supabase.rpc("everything_curation_summary", { p_section: LEADERBOARD });
  if (error) throw new Error(`could not load the leaderboard: ${error.message}`);
  const summary = data as unknown as { counts: Record<typeof LEADERBOARD, number>; creators: CurationCreator[] };
  return { count: summary.counts.leaderboard, creators: summary.creators };
}

/** Writes one row's changed columns, and fails loudly when the database let
 *  nothing through, which is what a non-admin gets. */
async function updateRow(noteId: string, change: Record<string, unknown>, what: string) {
  const { data, error } = await supabase.from(TABLE).update(change).eq("note_id", noteId).select("note_id");
  if (error) throw new Error(`could not ${what}: ${error.message}`);
  if (data.length === 0) throw new Error(`could not ${what}: only admins may change the list`);
}

export const setPosition = (noteId: string, position: number) => updateRow(noteId, { position }, "move the note");

export const setComment = (noteId: string, comment: string) => updateRow(noteId, { comment: comment.trim() || null }, "save the comment");

/** Marks a leaderboard note as posted on X, or takes the mark off. */
export const setPosted = (noteId: string, posted: boolean) => updateRow(noteId, { posted_at: posted ? new Date().toISOString() : null }, "change the posted mark");
