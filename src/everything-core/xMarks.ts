import { fetchAllRows } from "./paging";
import { supabase } from "./supabase";

/* Whether a note is on X (migrations 153 and 155). A note the local posting
 * tool sent to Typefully is scheduled until Typefully has published it, then
 * posted. An admin can also mark a note as posted by hand, or decide not to
 * post it. A note without a mark is not posted yet. The mark belongs to the
 * note, so the review page and the leaderboard show the same one, and a
 * rewrite of the note keeps it. Only admins can read or set it. */

export type XMark = "scheduled" | "posted" | "wont_post";

export const X_MARKS_TABLE = "everything_note_x_marks";

/** A post made through the local posting tool: the Typefully draft it
 *  created, and when Typefully schedules it. */
export interface TypefullyPost {
  draftId: string;
  scheduledFor: string | null;
}

/** What Typefully says about a draft. A draft that was published wrongly, or
 *  could not be published, is `failed`, which needs a human in Typefully. */
export type TypefullyDraftState =
  | { state: "scheduled"; scheduledFor: string | null }
  | { state: "published"; publishedAt: string | null; tweetUrl: string | null }
  | { state: "deleted" }
  | { state: "failed" };

/** A note that waits in Typefully. */
export interface ScheduledPost {
  noteId: string;
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

export async function fetchScheduledPosts(): Promise<ScheduledPost[]> {
  const rows = await fetchAllRows<{ note_id: string; typefully_draft_id: string; scheduled_for: string | null }>(
    () => supabase.from(X_MARKS_TABLE).select("note_id, typefully_draft_id, scheduled_for").eq("mark", "scheduled"),
    "note_id",
    { label: "scheduled posts" },
  );
  return rows.map((row) => ({ noteId: row.note_id, draftId: row.typefully_draft_id, scheduledFor: row.scheduled_for }));
}

/** Brings a scheduled note's mark up to date with its Typefully draft. The
 *  database changes the mark only while it is still scheduled for that
 *  draft, so a mark an admin set in the meantime wins. */
export async function updateXPost(post: ScheduledPost, draft: Exclude<TypefullyDraftState, { state: "failed" }>): Promise<void> {
  const { error } = await supabase.rpc("everything_update_x_post", {
    p_note: post.noteId,
    p_draft_id: post.draftId,
    p_state: draft.state,
    p_scheduled_for: draft.state === "scheduled" ? (draft.scheduledFor ?? undefined) : undefined,
    p_published_at: draft.state === "published" ? (draft.publishedAt ?? undefined) : undefined,
    p_tweet_url: draft.state === "published" ? (draft.tweetUrl ?? undefined) : undefined,
  });
  if (error) throw new Error(`could not update the X mark: ${error.message}`);
}
