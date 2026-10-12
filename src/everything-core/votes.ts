import { fetchAllRows } from "./paging";
import { supabase } from "./supabase";

/** A rating on X's three-way scale: helpful, somewhat helpful, not helpful. */
export type Vote = 1 | 0 | -1;

/** Every vote value, in the order the rating pills draw them. Callers that
 *  walk all three values, such as scoring each option, use this instead of
 *  writing the literals out again. */
export const VOTE_VALUES: readonly Vote[] = [1, 0, -1];

/** Fetches the signed-in user's own votes on notes. Row level security returns
 *  only their rows. */
export async function fetchMyVotes(): Promise<Map<string, Vote>> {
  // Row level security returns only the caller's own votes, and a voter has
  // one vote per note, so note_id is unique here and can carry the paging.
  const votes = await fetchAllRows<{ note_id: string; vote: number }>(
    () => supabase.from("everything_votes").select("note_id, vote"),
    "note_id",
    { label: "myVotes" },
  );
  return new Map(votes.map((v) => [v.note_id, v.vote as Vote]));
}

/** Casts a vote or changes an existing one, and returns the vote row's id,
 *  which a donation hangs off. A database trigger updates the note's counters,
 *  so the new tally shows for everyone. */
export async function castVote(noteId: string, voterId: string, vote: Vote, platform: "web" | "extension"): Promise<string> {
  const { data, error } = await supabase
    .from("everything_votes")
    .upsert({ note_id: noteId, voter_id: voterId, vote, platform }, { onConflict: "note_id,voter_id" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Retracts the caller's vote. Row level security lets them delete only their
 *  own row, and the donation row goes with it by cascade. */
export async function clearVote(noteId: string): Promise<void> {
  const { error } = await supabase.from("everything_votes").delete().eq("note_id", noteId);
  if (error) throw error;
}
