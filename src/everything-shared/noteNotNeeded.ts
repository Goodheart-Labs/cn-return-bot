import { supabase } from "./supabase";
import type { NnnRow } from "./types";
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

/** All entries on a set of claims, oldest first (page-scoped: the browser
 *  extension fetches one item's claims at a time). Tolerates a backend
 *  without migration 063 — the list just stays empty. */
export async function fetchNnnForClaims(claimIds: string[]): Promise<NnnRow[]> {
  if (claimIds.length === 0) return [];
  const { data } = await supabase
    .from("everything_note_not_needed")
    .select("*")
    .in("claim_id", claimIds)
    .order("created_at");
  return (data as NnnRow[]) ?? [];
}

/** One entry by id — refetch after a vote to pick up the trigger-computed
 *  counts (the extension has no realtime channel). */
export async function fetchNnnEntry(entryId: string): Promise<NnnRow | null> {
  const { data } = await supabase.from("everything_note_not_needed").select("*").eq("id", entryId).maybeSingle();
  return (data as NnnRow) ?? null;
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
export async function castNnnVote(entryId: string, voterId: string, vote: Vote) {
  const { error } = await supabase
    .from("everything_note_not_needed_votes")
    .upsert({ entry_id: entryId, voter_id: voterId, vote }, { onConflict: "entry_id,voter_id" });
  if (error) console.error("[common-notes] entry vote failed:", error.message);
}

/** Un-vote (RLS restricts deletion to the caller's own row). */
export async function clearNnnVote(entryId: string) {
  const { error } = await supabase.from("everything_note_not_needed_votes").delete().eq("entry_id", entryId);
  if (error) console.error("[common-notes] entry vote retract failed:", error.message);
}
