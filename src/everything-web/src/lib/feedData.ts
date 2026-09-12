import { supabase } from "../../../everything-shared/supabase";
import { detectSchema, noteQuery, normalizeNote } from "../../../everything-shared/notesQuery";
import type { FeedItemRow, FeedProjectRow, NnnRow, NoteRow } from "../../../everything-shared/types";

// The website reads one project at a time, because that is what the feed shows.
// Every query below either names the project or names the row it needs, and
// every one of them lists the columns the interface renders. Nothing here reads
// a whole table and nothing here reads a column the reader never sees. The
// review dashboard works the same way, and its data layer is the model for this
// one.

const ITEM_COLS = "id, project_id, url, title, published_at, created_at";

/** The projects the sidebar lists, most-voted first. A project with no
 *  content is left out, and since GOO-107 that matters: pressing "check this
 *  author's new posts" creates the creator's project immediately, and until
 *  the pipeline has actually checked something there is nothing to show under
 *  it. The anon key can create such a row, so the sidebar must not put
 *  whatever it names on the public site. Both the filter and the vote counts
 *  come from one database function (migration 093), because the anon key
 *  cannot read the votes table. */
export async function fetchProjects(): Promise<FeedProjectRow[]> {
  const { data, error } = await supabase.rpc("everything_projects_by_votes");
  if (error) throw error;
  return (data ?? []) as FeedProjectRow[];
}

/** One project's items. The chip row names them and orders them by date. */
export async function fetchProjectItems(projectId: string): Promise<FeedItemRow[]> {
  const { data, error } = await supabase
    .from("everything_items")
    .select(ITEM_COLS)
    .eq("project_id", projectId);
  if (error) throw error;
  return (data ?? []) as FeedItemRow[];
}

/** Every visible note in one project, with its claim and its citation links.
 *  The filter reaches from the note through its claim to that claim's item, so
 *  the database returns only this project's notes rather than all of them. */
export async function fetchProjectNotes(projectId: string): Promise<NoteRow[]> {
  const schema = await detectSchema();
  const { data, error } = await noteQuery(schema, { innerClaim: true, projectScoped: true })
    .eq("claim.item.project_id", projectId)
    .neq("status", "hidden");
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => normalizeNote(r, schema));
}

/** One note of this project, by id. A note from another project comes back as
 *  null, which is what lets the realtime handler ignore the changes it sees on
 *  projects the reader is not looking at. */
export async function fetchProjectNote(noteId: string, projectId: string): Promise<NoteRow | null> {
  const schema = await detectSchema();
  const { data } = await noteQuery(schema, { innerClaim: true, projectScoped: true })
    .eq("claim.item.project_id", projectId)
    .eq("id", noteId)
    .maybeSingle();
  return data ? normalizeNote(data, schema) : null;
}

/** Every note-not-needed entry in one project, scoped through the same claim and
 *  item join the notes use. A backend without migration 063 has no such table,
 *  and the list simply stays empty there. */
export async function fetchProjectNnn(projectId: string): Promise<NnnRow[]> {
  const schema = await detectSchema();
  if (!schema.hasNnn) return [];
  const { data, error } = await supabase
    .from("everything_note_not_needed")
    .select("*, claim:everything_claims!inner(item:everything_items!inner(project_id))")
    .eq("claim.item.project_id", projectId)
    .order("created_at");
  if (error) throw error;
  // The joined claim is only there to carry the filter, so it is dropped again.
  return ((data ?? []) as any[]).map(({ claim: _claim, ...entry }) => entry as NnnRow);
}
