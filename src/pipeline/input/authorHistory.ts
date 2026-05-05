/**
 * Author Note History
 *
 * Queries Supabase for past helpful community notes on a given author's posts.
 * Uses pipeline_runs (which stores author_id) joined with notes
 * and competing_notes to find relevant notes.
 */

import { getSupabaseClient } from "../../api/supabaseClient";

export interface AuthorNoteHistory {
  helpfulNotes: Array<{ tweetText: string; noteText: string }>;
  totalHelpful: number;
}

const EMPTY: AuthorNoteHistory = { helpfulNotes: [], totalHelpful: 0 };

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

  // Our notes on this author's tweets. tweet_text now lives on the tweets
  // table (post-merge); join it manually.
  // Use cn_status (overall) per CLAUDE.md — current_core_status misses notes
  // rated helpful by the expansion or group submodels.
  const { data: ourNotesRaw } = await supabase
    .from("notes")
    .select("note_id, tweet_id, note_text, cn_status, first_seen_at")
    .in("tweet_id", tweetIds)
    .not("note_text", "is", null);

  const { data: tweetRows } = await supabase
    .from("tweets")
    .select("tweet_id, text")
    .in("tweet_id", tweetIds);
  const tweetTextById = new Map((tweetRows ?? []).map((t) => [t.tweet_id, t.text]));

  const ourNotes = (ourNotesRaw ?? [])
    .map((n) => ({
      tweet_text: tweetTextById.get(n.tweet_id),
      note_text: n.note_text,
      cn_status: n.cn_status,
    }))
    .filter((n) => n.tweet_text);

  // Competing helpful notes on this author's tweets — fetch competing_notes
  // for our note_ids, then attach tweet_text via the same map.
  const ourNoteIds = (ourNotesRaw ?? []).map((n) => n.note_id);
  const ourNoteIdToTweetId = new Map((ourNotesRaw ?? []).map((n) => [n.note_id, n.tweet_id]));

  let competingNotes: Array<{ tweet_text: string; note_text: string; current_status: string }> = [];
  if (ourNoteIds.length) {
    const chunkSize = 200;
    for (let i = 0; i < ourNoteIds.length; i += chunkSize) {
      const chunk = ourNoteIds.slice(i, i + chunkSize);
      const { data: cn } = await supabase
        .from("competing_notes")
        .select("our_note_id, note_text, current_status")
        .in("our_note_id", chunk)
        .not("note_text", "is", null);

      if (cn) {
        for (const c of cn) {
          const tweetId = ourNoteIdToTweetId.get(c.our_note_id);
          const tweetText = tweetId ? tweetTextById.get(tweetId) : undefined;
          if (tweetText) {
            competingNotes.push({
              tweet_text: tweetText,
              note_text: c.note_text,
              current_status: c.current_status,
            });
          }
        }
      }
    }
  }

  // Combine and count
  const allNotes = [
    ...ourNotes.map((n) => ({
      tweetText: n.tweet_text!,
      noteText: n.note_text,
      status: n.cn_status,
    })),
    ...competingNotes.map((n) => ({
      tweetText: n.tweet_text,
      noteText: n.note_text,
      status: n.current_status,
    })),
  ];

  const helpful = allNotes.filter((n) => n.status === "CURRENTLY_RATED_HELPFUL" && n.tweetText && n.noteText);

  return {
    helpfulNotes: helpful.slice(0, 5).map((n) => ({ tweetText: n.tweetText, noteText: n.noteText })),
    totalHelpful: helpful.length,
  };
}
