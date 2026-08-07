import type { VoteValue } from "../dashboard-shared/Ratings";
import { supabase } from "./supabase";

export type Vote = VoteValue;

/** The signed-in user's own votes (RLS returns only their rows). */
export async function fetchMyVotes(): Promise<Map<string, Vote>> {
  const { data } = await supabase.from("everything_votes").select("note_id, vote");
  return new Map((data ?? []).map((v) => [v.note_id as string, v.vote as Vote]));
}

/** Cast or change a vote; the counter trigger updates the note live for
 *  everyone. Returns the vote row's id (059) — the key the donation
 *  hangs off — as a separate read so the vote itself never depends on the new
 *  column (an older backend just returns null and the donation box stays shut). */
export async function castVote(noteId: string, voterId: string, vote: Vote): Promise<string | null> {
  const { error } = await supabase
    .from("everything_votes")
    .upsert({ note_id: noteId, voter_id: voterId, vote }, { onConflict: "note_id,voter_id" });
  if (error) {
    console.error("[common-notes] vote failed:", error.message);
    return null;
  }
  const { data } = await supabase.from("everything_votes").select("id").eq("note_id", noteId).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/** Un-vote (RLS restricts deletion to the caller's own row). */
export async function clearVote(noteId: string) {
  const { error } = await supabase.from("everything_votes").delete().eq("note_id", noteId);
  if (error) console.error("[common-notes] vote retract failed:", error.message);
}
