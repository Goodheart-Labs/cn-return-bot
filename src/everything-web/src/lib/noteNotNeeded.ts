import { supabase } from "./supabase";
import type { Vote } from "./votes";

/** Insert a "note not needed" entry on a claim and return its id. The DB
 *  trigger auto-casts the author's helpful vote. */
export async function postNnn(params: {
  claimId: string;
  body: string;
  authorId: string;
  authorName: string | null;
}): Promise<string | null> {
  const { data, error } = await supabase
    .from("everything_note_not_needed")
    .insert({
      claim_id: params.claimId,
      author_id: params.authorId,
      author_name: params.authorName,
      body: params.body,
    })
    .select("id")
    .single();
  return error ? null : (data as { id: string }).id;
}

/** Delete own entry (RLS-scoped). Awaits internally — a supabase-js query
 *  builder only executes when awaited, so a fire-and-forget caller would
 *  silently never send the request. */
export async function deleteNnn(entryId: string) {
  const { error } = await supabase.from("everything_note_not_needed").delete().eq("id", entryId);
  if (error) console.error("Note-not-needed delete failed:", error.message);
}

/** The signed-in user's own entry votes (RLS returns only their rows). */
export async function fetchMyNnnVotes(): Promise<Map<string, Vote>> {
  const { data } = await supabase.from("everything_note_not_needed_votes").select("entry_id, vote");
  return new Map((data ?? []).map((v) => [v.entry_id as string, v.vote as Vote]));
}

/** Cast or change an entry vote; the counter trigger updates the entry live. */
export function castNnnVote(entryId: string, voterId: string, vote: Vote) {
  return supabase
    .from("everything_note_not_needed_votes")
    .upsert({ entry_id: entryId, voter_id: voterId, vote }, { onConflict: "entry_id,voter_id" });
}

/** Un-vote (RLS restricts deletion to the caller's own row). */
export function clearNnnVote(entryId: string) {
  return supabase.from("everything_note_not_needed_votes").delete().eq("entry_id", entryId);
}
