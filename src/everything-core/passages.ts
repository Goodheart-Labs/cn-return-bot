import { fetchAllRows } from "./paging";
import { supabase } from "./supabase";
import type { TablesInsert } from "./database.types";
import type { DraftOutcome, PassageHighlight, PassageQuestion } from "./passageHighlights";
import type { Vote } from "./votes";

export async function fetchPassageQuestions(itemId: string, passage: string, authorId: string): Promise<PassageQuestion[]> {
  const { data, error } = await supabase.from("everything_passage_questions").select("*")
    .eq("item_id", itemId).eq("passage", passage).eq("author_id", authorId).order("created_at");
  if (error) throw error;
  return data;
}

/** Every question one reader asked on one article: its passage, and whether
 *  Opus has answered it yet. */
export async function fetchAskedPassages(itemId: string, authorId: string): Promise<Pick<PassageQuestion, "id" | "passage" | "status">[]> {
  return fetchAllRows<Pick<PassageQuestion, "id" | "passage" | "status">>(
    () => supabase.from("everything_passage_questions").select("id, passage, status").eq("item_id", itemId).eq("author_id", authorId),
    "id",
    { label: "askedPassages" },
  );
}

/** Records what the reader did with the draft of a question. Null puts a
 *  discarded draft back. */
export async function setDraftOutcome(questionId: string, outcome: DraftOutcome | null): Promise<void> {
  const { error } = await supabase.from("everything_passage_questions")
    .update({ draft_outcome: outcome?.kind ?? null, draft_posted_id: outcome?.kind === "posted" ? outcome.postedId : null })
    .eq("id", questionId);
  if (error) throw error;
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

/** Posts a key point or forecast and returns its id. */
export async function postPassageHighlight(row: TablesInsert<"everything_passage_highlights">): Promise<string> {
  const { data, error } = await supabase.from("everything_passage_highlights").insert(row).select("id").single();
  if (error) throw error;
  return data.id;
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
