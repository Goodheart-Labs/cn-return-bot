import { supabase } from "./supabase";

/* The corrections page (migration 193): notes after which the author changed
 * their post. A note gets on it when the daily job finds its passage changed
 * (everything_claims.updated_quote), or when an admin adds it with a link that
 * shows the correction, and can take such a row off again. Everyone can read
 * the list. */

/** One correction: the note, the link an admin gave that shows the author
 *  corrected the post (null when we found the change ourselves), and when it
 *  was recorded. */
export interface CorrectionRow {
  note_id: string;
  evidence_url: string | null;
  corrected_at: string;
}

/** How many corrections one page of the list holds. */
export const CORRECTIONS_PAGE_SIZE = 30;

const TABLE = "everything_note_corrections";

const NOTE_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The note a pasted link names: the `note` parameter of a link to one note,
 *  or a note's id on its own. Null when the text names no note. */
export function noteIdFromLink(text: string): string | null {
  const trimmed = text.trim();
  let candidate = trimmed;
  try {
    candidate = new URL(trimmed).searchParams.get("note") ?? "";
  } catch {
    // Not an address, so it has to be a bare id.
  }
  return new RegExp(`^${NOTE_ID.source}$`, "i").test(candidate) ? candidate.toLowerCase() : null;
}

/** The link as the database accepts it, or null when it is not an https
 *  address. */
export function evidenceLink(text: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** One page of the corrections, the most recent first, starting after the
 *  row `after`. A note that was deleted or hidden is left out. */
export async function fetchCorrectionsPage(after: CorrectionRow | null): Promise<CorrectionRow[]> {
  const { data, error } = await supabase.rpc("everything_corrections_page", {
    p_after_at: after?.corrected_at,
    p_after_note_id: after?.note_id,
    p_limit: CORRECTIONS_PAGE_SIZE,
  });
  if (error) throw new Error(`could not load the corrections: ${error.message}`);
  return data;
}

/** Records that the author corrected the post after this note. */
export async function addCorrection(noteId: string, evidenceUrl: string): Promise<void> {
  const { error } = await supabase.from(TABLE).insert({ note_id: noteId, evidence_url: evidenceUrl });
  if (!error) return;
  if (error.code === "23505") throw new Error("This note is already on the list.");
  if (error.code === "23503") throw new Error("No note has this id.");
  throw new Error(`could not add the correction: ${error.message}`);
}

/** Takes a note off the corrections. */
export async function removeCorrection(noteId: string): Promise<void> {
  const { data, error } = await supabase.from(TABLE).delete().eq("note_id", noteId).select("note_id");
  if (error) throw new Error(`could not take the correction off: ${error.message}`);
  if (data.length === 0) throw new Error("could not take the correction off: it is no longer on the list, or you are not an admin");
}
