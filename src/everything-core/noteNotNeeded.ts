import { fetchAllRows, fetchInBatches } from "./paging";
import { supabase } from "./supabase";
import type { NnnRow } from "./types";
import type { Vote } from "./votes";

/* "Note not needed" entries: arguments that a claim needs no note at all.
 * They are keyed to the claim, not to a note. */

const asNnnRows = (rows: unknown[]) => rows as NnnRow[];

const oldestFirst = (a: NnnRow, b: NnnRow) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/** All entries on a set of claims, oldest first. The extension asks for the
 *  claims of one page at a time, so the set stays small. */
export async function fetchNnnForClaims(claimIds: string[]): Promise<NnnRow[]> {
  const entries = await fetchInBatches<NnnRow>(
    (chunk) => supabase.from("everything_note_not_needed").select("*").in("claim_id", chunk),
    claimIds,
    "id",
    { label: "nnnForClaims" },
  );
  return entries.sort(oldestFirst);
}

/** Every entry in one project, oldest first, scoped through the same claim
 *  and item join the project's notes use. */
export async function fetchProjectNnn(projectId: string): Promise<NnnRow[]> {
  const rows = await fetchAllRows<NnnRow & { claim: unknown }>(
    () => supabase
      .from("everything_note_not_needed")
      .select("*, claim:everything_claims!inner(item:everything_items!inner(project_id))")
      .eq("claim.item.project_id", projectId),
    "id",
    { label: "projectNnn" },
  );
  // The joined claim is only there to carry the filter, so it is dropped again.
  return asNnnRows(rows.map(({ claim: _claim, ...entry }) => entry)).sort(oldestFirst);
}

/** Fetches one entry by id, to pick up the counts the database trigger
 *  recomputed after a vote. */
export async function fetchNnnEntry(entryId: string): Promise<NnnRow | null> {
  const { data, error } = await supabase.from("everything_note_not_needed").select("*").eq("id", entryId).maybeSingle();
  if (error) throw error;
  return data as NnnRow | null;
}

/** Inserts an entry on a claim and returns its id. A database trigger casts
 *  the author's own helpful vote on it. */
export async function postNnn(params: { claimId: string; body: string; authorId: string; authorName: string | null }): Promise<string> {
  const { data, error } = await supabase
    .from("everything_note_not_needed")
    .insert({ claim_id: params.claimId, author_id: params.authorId, author_name: params.authorName, body: params.body })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Deletes the caller's own entry. Row level security limits it to their own
 *  rows. */
export async function deleteNnn(entryId: string): Promise<void> {
  const { error } = await supabase.from("everything_note_not_needed").delete().eq("id", entryId);
  if (error) throw error;
}

/** The signed-in user's own votes on entries. Row level security returns only
 *  their rows. */
export async function fetchMyNnnVotes(): Promise<Map<string, Vote>> {
  // Row level security returns only the caller's own votes, and a voter has
  // one vote per entry, so entry_id is unique here and can carry the paging.
  const votes = await fetchAllRows<{ entry_id: string; vote: number }>(
    () => supabase.from("everything_note_not_needed_votes").select("entry_id, vote"),
    "entry_id",
    { label: "myNnnVotes" },
  );
  return new Map(votes.map((v) => [v.entry_id, v.vote as Vote]));
}

/** Casts a vote on an entry, or changes an existing one. A database trigger
 *  keeps the entry's counts up to date. Entry votes never mint donations. */
export async function castNnnVote(entryId: string, voterId: string, vote: Vote): Promise<void> {
  const { error } = await supabase
    .from("everything_note_not_needed_votes")
    .upsert({ entry_id: entryId, voter_id: voterId, vote }, { onConflict: "entry_id,voter_id" });
  if (error) throw error;
}

/** Retracts a vote on an entry. */
export async function clearNnnVote(entryId: string): Promise<void> {
  const { error } = await supabase.from("everything_note_not_needed_votes").delete().eq("entry_id", entryId);
  if (error) throw error;
}
