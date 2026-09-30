import { supabase } from "./supabase";
import type { TablesInsert } from "./database.types";
import type { PassageHighlight, PassageQuestion } from "./passageHighlights";
import type { Vote } from "./votes";

export async function fetchPassageQuestions(itemId: string, passage: string, authorId: string): Promise<PassageQuestion[]> {
  const { data, error } = await supabase.from("everything_passage_questions").select("*")
    .eq("item_id", itemId).eq("passage", passage).eq("author_id", authorId).order("created_at");
  if (error) throw error;
  return data;
}

export async function askPassageQuestion(itemId: string, passage: string, question: string, authorId: string): Promise<string> {
  const { data, error } = await supabase.from("everything_passage_questions").insert({ item_id: itemId, passage, question, author_id: authorId }).select("id").single();
  if (error) throw error;
  return data.id;
}

export function subscribeToPassages(itemId: string, onChange: () => void): () => void {
  const channel = supabase.channel(`passages-${itemId}-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "everything_passage_questions", filter: `item_id=eq.${itemId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "everything_passage_highlights", filter: `item_id=eq.${itemId}` }, onChange)
    .subscribe((status) => { if (status === "SUBSCRIBED") onChange(); });
  return () => void supabase.removeChannel(channel);
}

export async function fetchPassageHighlights(itemId: string): Promise<PassageHighlight[]> {
  const { data, error } = await supabase.from("everything_passage_highlights").select("*").eq("item_id", itemId).order("created_at");
  if (error) throw error;
  return data;
}

export async function postPassageHighlight(row: TablesInsert<"everything_passage_highlights">): Promise<void> {
  const { error } = await supabase.from("everything_passage_highlights").insert(row);
  if (error) throw error;
}

export async function deletePassageHighlight(id: string): Promise<void> {
  const { error } = await supabase.from("everything_passage_highlights").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchHighlightVotes(ids: string[]): Promise<Map<string, Vote>> {
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from("everything_passage_highlight_votes").select("entry_id, vote").in("entry_id", ids);
  if (error) throw error;
  return new Map(data.map((row) => [row.entry_id, row.vote as Vote]));
}

export async function voteOnHighlight(id: string, voterId: string, vote: Vote | null): Promise<void> {
  const { error } = vote === null
    ? await supabase.from("everything_passage_highlight_votes").delete().eq("entry_id", id).eq("voter_id", voterId)
    : await supabase.from("everything_passage_highlight_votes").upsert({ entry_id: id, voter_id: voterId, vote }, { onConflict: "entry_id,voter_id" });
  if (error) throw error;
}
