import { supabase } from "./supabase";
import type { NnnRow } from "./types";
import type { Vote } from "./votes";

/** Inserts a "note not needed" entry on a claim and returns its id. A database
 *  trigger casts the author's own helpful vote on it. */
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

/** All entries on a set of claims, oldest first. The set stays small because the
 *  browser extension asks for the claims of one item at a time. A backend that has
 *  not run migration 063 yet is tolerated. The list simply comes back empty. */
export async function fetchNnnForClaims(claimIds: string[]): Promise<NnnRow[]> {
  if (claimIds.length === 0) return [];
  const { data } = await supabase
    .from("everything_note_not_needed")
    .select("*")
    .in("claim_id", claimIds)
    .order("created_at");
  return (data as NnnRow[]) ?? [];
}

/** Fetches a single entry by id. Callers refetch after a vote to pick up the counts
 *  the database trigger recomputed, because the extension has no realtime channel. */
export async function fetchNnnEntry(entryId: string): Promise<NnnRow | null> {
  const { data } = await supabase.from("everything_note_not_needed").select("*").eq("id", entryId).maybeSingle();
  return (data as NnnRow) ?? null;
}

/** Deletes the caller's own entry. Row level security limits it to their own rows.
 *  This function awaits the query itself. A supabase-js query builder only runs when
 *  it is awaited, so a caller that fired and forgot would silently send no
 *  request. */
export async function deleteNnn(entryId: string) {
  const { error } = await supabase.from("everything_note_not_needed").delete().eq("id", entryId);
  if (error) console.error("Note-not-needed delete failed:", error.message);
}

/** The signed-in user's own votes on entries. Row level security returns only their
 *  rows. */
export async function fetchMyNnnVotes(): Promise<Map<string, Vote>> {
  const { data } = await supabase.from("everything_note_not_needed_votes").select("entry_id, vote");
  return new Map((data ?? []).map((v) => [v.entry_id as string, v.vote as Vote]));
}

/** Casts a vote on an entry, or changes an existing one. A database trigger keeps the
 *  entry's counts up to date. */
export async function castNnnVote(entryId: string, voterId: string, vote: Vote) {
  const { error } = await supabase
    .from("everything_note_not_needed_votes")
    .upsert({ entry_id: entryId, voter_id: voterId, vote }, { onConflict: "entry_id,voter_id" });
  if (error) console.error("[common-notes] entry vote failed:", error.message);
}

/** Retracts a vote. Row level security lets the caller delete only their own row. */
export async function clearNnnVote(entryId: string) {
  const { error } = await supabase.from("everything_note_not_needed_votes").delete().eq("entry_id", entryId);
  if (error) console.error("[common-notes] entry vote retract failed:", error.message);
}
