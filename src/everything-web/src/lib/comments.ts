import { supabase } from "./supabase";
import type { Vote } from "./votes";

/** Insert a comment and return its id. Top-level comments carry the vote whose
 *  reasoning they publish; replies carry a parent instead. The DB trigger
 *  auto-casts the author's helpful vote. */
export async function postComment(params: {
  noteId: string;
  body: string;
  authorId: string;
  authorName: string | null;
  voteId?: string;
  parentCommentId?: string;
}): Promise<string | null> {
  const { data, error } = await supabase
    .from("everything_comments")
    .insert({
      note_id: params.noteId,
      parent_comment_id: params.parentCommentId ?? null,
      vote_id: params.voteId ?? null,
      author_id: params.authorId,
      author_name: params.authorName,
      body: params.body,
    })
    .select("id")
    .single();
  return error ? null : (data as { id: string }).id;
}

/** Delete own comment (RLS-scoped). Awaits internally — a supabase-js query
 *  builder only executes when awaited, so a fire-and-forget caller would
 *  silently never send the request. */
export async function deleteComment(commentId: string) {
  const { error } = await supabase.from("everything_comments").delete().eq("id", commentId);
  if (error) console.error("Comment delete failed:", error.message);
}

/** The signed-in user's own comment votes (RLS returns only their rows). */
export async function fetchMyCommentVotes(): Promise<Map<string, Vote>> {
  const { data } = await supabase.from("everything_comment_votes").select("comment_id, vote");
  return new Map((data ?? []).map((v) => [v.comment_id as string, v.vote as Vote]));
}

/** Cast or change a comment vote; the counter trigger updates the comment live. */
export function castCommentVote(commentId: string, voterId: string, vote: Vote) {
  return supabase
    .from("everything_comment_votes")
    .upsert({ comment_id: commentId, voter_id: voterId, vote }, { onConflict: "comment_id,voter_id" });
}

/** Un-vote (RLS restricts deletion to the caller's own row). */
export function clearCommentVote(commentId: string) {
  return supabase.from("everything_comment_votes").delete().eq("comment_id", commentId);
}
