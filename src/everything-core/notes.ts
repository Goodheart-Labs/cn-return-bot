import type { QueryData } from "@supabase/supabase-js";
import { fetchAllRows } from "./paging";
import { supabase } from "./supabase";
import type { NoteRow, NoteSourceDetail } from "./types";

/* Every read of notes goes through the two selects below, so every caller gets
 * the same NoteRow shape: the note, its claim, and its citation links.
 *
 * Only the source URLs are read, because the URLs are what the note text
 * renders. The quote and the explanation of each source are much larger and
 * sit behind the "Source details" button, so fetchNoteSourceDetails
 * fetches them when a reader opens that. The button still has to know whether
 * there is anything to show. That is what the second, aliased embed of the
 * same table is for: the query filters it down to the sources that carry a
 * quote, so its length answers the question without reading a single quote. */

const CLAIM_COLS =
  "id, item_id, claim, context_quote, context_paragraph, updated_quote, context_url, start_seconds, end_seconds, image_urls";
const SOURCES = "sources:everything_note_sources(url, sort_order), detailed:everything_note_sources(sort_order)";
const NOTE_SELECT = `*, claim:everything_claims!inner(${CLAIM_COLS}), ${SOURCES}` as const;
/** Filtering on a project means reaching through the claim to its item, so
 *  that item has to be embedded for PostgREST to accept
 *  `claim.item.project_id` as a filter. Only the join column is read. */
const PROJECT_NOTE_SELECT = `*, claim:everything_claims!inner(${CLAIM_COLS}, item:everything_items!inner(project_id)), ${SOURCES}` as const;

const noteQuery = () => supabase.from("everything_notes").select(NOTE_SELECT).not("detailed.quote", "is", null);
const projectNoteQuery = () =>
  supabase.from("everything_notes").select(PROJECT_NOTE_SELECT).not("detailed.quote", "is", null);

type RawNote = QueryData<ReturnType<typeof noteQuery>>[number];

/** Turns a raw note row into a NoteRow. A note stores one source row per
 *  supporting quote, and `has_source_details` says whether the reveal has
 *  anything in it. */
function toNoteRow({ detailed, claim, ...note }: RawNote): NoteRow {
  return {
    ...note,
    status: note.status as NoteRow["status"],
    // image_urls is a jsonb column, which the generated types cannot narrow.
    claim: { ...claim, image_urls: (claim.image_urls as string[] | null) ?? [] },
    has_source_details: detailed.length > 0,
  };
}

/** Fetches one note by id. Callers refetch a note after a vote, so they pick
 *  up the counts the database trigger wrote. */
export async function fetchNote(id: string): Promise<NoteRow | null> {
  const { data, error } = await noteQuery().eq("id", id).maybeSingle();
  if (error) throw error;
  return data && toNoteRow(data);
}

/** Every visible note on one item. The extension shows one page at a time and
 *  reads its notes this way. */
export async function fetchNotesForItem(itemId: string): Promise<NoteRow[]> {
  const notes = await fetchAllRows<RawNote>(() => noteQuery().eq("claim.item_id", itemId).neq("status", "hidden"), "id", { label: "itemNotes" });
  return notes.map(toNoteRow);
}

/** Every visible note in one project. The filter reaches from the note through
 *  its claim to that claim's item, so the database returns only this
 *  project's notes. */
export async function fetchProjectNotes(projectId: string): Promise<NoteRow[]> {
  const notes = await fetchAllRows<RawNote>(
    () => projectNoteQuery().eq("claim.item.project_id", projectId).neq("status", "hidden"),
    "id",
    { label: "projectNotes" },
  );
  return notes.map(toNoteRow);
}

/** One note of this project, by id. A note from another project comes back as
 *  null, which is what lets the website's realtime handler ignore changes on
 *  projects the reader is not looking at. */
export async function fetchProjectNote(noteId: string, projectId: string): Promise<NoteRow | null> {
  const { data, error } = await projectNoteQuery().eq("claim.item.project_id", projectId).eq("id", noteId).maybeSingle();
  if (error) throw error;
  return data && toNoteRow(data);
}

/** The quote and the explanation behind one note's "Source details"
 *  reveal. A source with no quote has no body to show, so it is left out here
 *  the same way the reveal leaves it out. */
export async function fetchNoteSourceDetails(noteId: string): Promise<NoteSourceDetail[]> {
  const { data, error } = await supabase
    .from("everything_note_sources")
    .select("url, quote, explanation, sort_order")
    .eq("note_id", noteId)
    .not("quote", "is", null)
    .order("sort_order");
  if (error) throw error;
  return data as NoteSourceDetail[];
}

/** Deletes one of the caller's own draft notes. Row level security only lets
 *  an author delete their own drafts, and a delete it blocks still succeeds
 *  with zero rows. So the deleted ids are read back, and zero rows counts as a
 *  failure. */
export async function deleteNote(noteId: string): Promise<void> {
  const { data, error } = await supabase.from("everything_notes").delete().eq("id", noteId).select("id");
  if (error) throw error;
  if (data.length === 0) throw new Error("no note deleted: only your own draft notes can be deleted");
}
