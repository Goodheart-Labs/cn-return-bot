import { supabase } from "./supabase";

/* Whether a note was posted on X, or the admins decided not to post it
 * (migration 153). A note without a mark is not posted yet. The mark belongs
 * to the note, so the review page and the leaderboard show the same one, and
 * a rewrite of the note keeps it. Only admins can read or set it. */

export type XMark = "posted" | "wont_post";

export const X_MARKS_TABLE = "everything_note_x_marks";

/** A post made through the local posting tool: the Typefully draft it
 *  created, and when Typefully schedules it. */
export interface TypefullyPost {
  draftId: string;
  scheduledFor: string | null;
}

/** Sets a note's mark, or clears it with null. */
export async function setXMark(noteId: string, mark: XMark | null, post?: TypefullyPost): Promise<void> {
  const { error } = await supabase.rpc("everything_set_x_mark", {
    p_note: noteId,
    // The database reads a missing mark as "clear it".
    p_mark: mark as string,
    p_typefully_draft_id: post?.draftId,
    p_scheduled_for: post?.scheduledFor ?? undefined,
  });
  if (error) throw new Error(`could not change the X mark: ${error.message}`);
}
