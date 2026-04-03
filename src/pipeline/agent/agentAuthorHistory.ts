/**
 * Author Note History
 *
 * Queries Supabase for past helpful community notes on a given author's posts.
 * Uses pipeline_runs (which stores author_id) joined with canonical_note_information
 * and competing_notes to find relevant notes.
 */

import { getSupabaseClient } from "../../api/supabaseClient";

export interface AuthorNoteHistory {
  helpfulNotes: Array<{ tweetText: string; noteText: string }>;
  totalHelpful: number;
  totalNotHelpful: number;
}

const EMPTY: AuthorNoteHistory = { helpfulNotes: [], totalHelpful: 0, totalNotHelpful: 0 };

export async function getAuthorNoteHistory(authorId: string): Promise<AuthorNoteHistory> {
  const supabase = getSupabaseClient();

  // Find tweet_ids for this author from pipeline_runs
  const { data: runs, error: runsError } = await supabase
    .from("pipeline_runs")
    .select("tweet_id")
    .eq("author_id", authorId)
    .limit(500);

  if (runsError || !runs?.length) return EMPTY;

  const tweetIds = [...new Set(runs.map((r) => r.tweet_id))];

  // Our helpful notes on this author's tweets
  const { data: ourNotes } = await supabase
    .from("canonical_note_information")
    .select("tweet_text, note_text, current_core_status, first_seen_at")
    .in("tweet_id", tweetIds)
    .not("tweet_text", "is", null)
    .not("note_text", "is", null);

  // Competing helpful notes on this author's tweets
  const { data: cniForCompeting } = await supabase
    .from("canonical_note_information")
    .select("note_id, tweet_text")
    .in("tweet_id", tweetIds)
    .not("tweet_text", "is", null);

  let competingNotes: Array<{ tweet_text: string; note_text: string; current_core_status: string }> = [];
  if (cniForCompeting?.length) {
    const ourNoteIds = cniForCompeting.map((c) => c.note_id);
    const tweetTextByNoteId = new Map(cniForCompeting.map((c) => [c.note_id, c.tweet_text]));

    // Batch query competing notes (Supabase IN has a limit, chunk if needed)
    const chunkSize = 200;
    for (let i = 0; i < ourNoteIds.length; i += chunkSize) {
      const chunk = ourNoteIds.slice(i, i + chunkSize);
      const { data: cn } = await supabase
        .from("competing_notes")
        .select("our_note_id, note_text, current_core_status")
        .in("our_note_id", chunk)
        .not("note_text", "is", null);

      if (cn) {
        for (const c of cn) {
          competingNotes.push({
            tweet_text: tweetTextByNoteId.get(c.our_note_id) ?? "",
            note_text: c.note_text,
            current_core_status: c.current_core_status,
          });
        }
      }
    }
  }

  // Combine and count
  const allNotes = [
    ...(ourNotes ?? []).map((n) => ({
      tweetText: n.tweet_text,
      noteText: n.note_text,
      status: n.current_core_status,
    })),
    ...competingNotes.map((n) => ({
      tweetText: n.tweet_text,
      noteText: n.note_text,
      status: n.current_core_status,
    })),
  ];

  const totalHelpful = allNotes.filter((n) => n.status === "CURRENTLY_RATED_HELPFUL").length;
  const totalNotHelpful = allNotes.filter((n) => n.status === "CURRENTLY_RATED_NOT_HELPFUL").length;

  const helpfulNotes = allNotes
    .filter((n) => n.status === "CURRENTLY_RATED_HELPFUL" && n.tweetText && n.noteText)
    .slice(0, 5)
    .map((n) => ({ tweetText: n.tweetText, noteText: n.noteText }));

  return { helpfulNotes, totalHelpful, totalNotHelpful };
}
