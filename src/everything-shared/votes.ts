import type { VoteValue } from "../dashboard-shared/Ratings";
import { supabase } from "./supabase";

export type Vote = VoteValue;

/** Fetches the signed-in user's own votes. Row level security returns only their
 *  rows. */
export async function fetchMyVotes(): Promise<Map<string, Vote>> {
  const { data } = await supabase.from("everything_votes").select("note_id, vote");
  return new Map((data ?? []).map((v) => [v.note_id as string, v.vote as Vote]));
}

/** Casts a vote or changes an existing one. A database trigger updates the note's
 *  counters, so the new tally shows for everyone. The function then reads back
 *  the vote row's id, which migration 059 added and which a donation hangs off.
 *  That read is a separate query so the vote itself never depends on the new
 *  column. Against an older backend the read returns null and the donation box
 *  stays shut. */
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

/** Retracts the caller's vote. Row level security lets them delete only their own
 *  row. */
export async function clearVote(noteId: string) {
  const { error } = await supabase.from("everything_votes").delete().eq("note_id", noteId);
  if (error) console.error("[common-notes] vote retract failed:", error.message);
}
