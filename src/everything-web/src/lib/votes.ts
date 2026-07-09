import { supabase } from "./supabase";

export type Vote = 1 | -1;

/** The signed-in user's own votes (RLS returns only their rows). */
export async function fetchMyVotes(): Promise<Map<string, Vote>> {
  const { data } = await supabase.from("everything_votes").select("note_id, vote");
  return new Map((data ?? []).map((v) => [v.note_id as string, v.vote as Vote]));
}

/** Cast or change a vote; the counter trigger updates the note live for everyone. */
export function castVote(noteId: string, voterId: string, vote: Vote) {
  return supabase
    .from("everything_votes")
    .upsert({ note_id: noteId, voter_id: voterId, vote }, { onConflict: "note_id,voter_id" });
}

/** Un-vote (RLS restricts deletion to the caller's own row). */
export function clearVote(noteId: string) {
  return supabase.from("everything_votes").delete().eq("note_id", noteId);
}
