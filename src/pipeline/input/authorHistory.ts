/**
 * Author Note History
 *
 * Queries Supabase for past community notes on a given author's posts — the
 * ones raters found helpful, and (behind the `on_with_unhelpful` A/B arm) the
 * ones they rejected. Looks up the author's tweets (tweets.author_id) and joins
 * notes and competing_notes.
 */

import { getSupabaseClient } from "../../api/supabaseClient";

export interface AuthorNote {
  tweetText: string;
  noteText: string;
}

/**
 * Past notes on an author's posts. Both kinds are always gathered — which of
 * them reaches the model is an A/B decision made at render time, so one cached
 * BotInput serves every arm. `unhelpfulNotes` / `totalUnhelpful` are absent on
 * runs logged before the arm existed — read them defensively when replaying.
 */
export interface AuthorNoteHistory {
  helpfulNotes: AuthorNote[];
  totalHelpful: number;
  unhelpfulNotes: AuthorNote[];
  totalUnhelpful: number;
}

const STATUS_HELPFUL = "CURRENTLY_RATED_HELPFUL";
const STATUS_NOT_HELPFUL = "CURRENTLY_RATED_NOT_HELPFUL";

/** How many notes of each kind we quote to the model. */
const MAX_NOTES_IN_PROMPT = 5;

const EMPTY: AuthorNoteHistory = {
  helpfulNotes: [],
  totalHelpful: 0,
  unhelpfulNotes: [],
  totalUnhelpful: 0,
};

export async function getAuthorNoteHistory(authorId: string): Promise<AuthorNoteHistory> {
  const supabase = getSupabaseClient();

  // Find this author's past tweets (+ their text). author_id moved from
  // pipeline_runs to the tweets table in migration 033 (indexed via
  // idx_tweets_author_id).
  const { data: authorTweets, error: tweetsError } = await supabase
    .from("tweets")
    .select("tweet_id, text")
    .eq("author_id", authorId)
    .limit(500);

  if (tweetsError || !authorTweets?.length) return EMPTY;

  const tweetTextById = new Map(authorTweets.map((t) => [t.tweet_id, t.text]));
  const tweetIds = [...tweetTextById.keys()];

  // Our notes on this author's tweets. Use cn_status (overall) per CLAUDE.md —
  // current_core_status misses notes rated helpful by the expansion or group
  // submodels.
  const { data: ourNotesRaw } = await supabase
    .from("notes")
    .select("note_id, tweet_id, note_text, cn_status")
    .in("tweet_id", tweetIds)
    .not("note_text", "is", null);

  const ourNotes = (ourNotesRaw ?? [])
    .map((n) => ({
      tweet_text: tweetTextById.get(n.tweet_id),
      note_text: n.note_text,
      cn_status: n.cn_status,
    }))
    .filter((n) => n.tweet_text);

  // Competing notes on this author's tweets — query by tweet_id (not our_note_id)
  // so we also surface helpful notes on tweets we never noted ourselves: the
  // our_note_id=null "missed helpful" rows updateNoteFeedback records from the
  // public CN dump. Joining by our_note_id would only see competing notes tied
  // to our own notes, missing the rest of the author's helpful-note history.
  const competingNotes: Array<{ tweet_text: string; note_text: string; current_status: string }> = [];
  const chunkSize = 200;
  for (let i = 0; i < tweetIds.length; i += chunkSize) {
    const chunk = tweetIds.slice(i, i + chunkSize);
    const { data: cn } = await supabase
      .from("competing_notes")
      .select("tweet_id, note_text, current_status")
      .in("tweet_id", chunk)
      .not("note_text", "is", null);

    for (const c of cn ?? []) {
      const tweetText = tweetTextById.get(c.tweet_id);
      if (tweetText) {
        competingNotes.push({
          tweet_text: tweetText,
          note_text: c.note_text,
          current_status: c.current_status,
        });
      }
    }
  }

  // Combine. Ours first, so that when we trim to MAX_NOTES_IN_PROMPT the notes
  // we wrote survive — a rejection of our own note is the sharpest warning.
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
  ].filter((n) => n.tweetText && n.noteText);

  const helpful = allNotes.filter((n) => n.status === STATUS_HELPFUL);
  // Same rows, second filter — no extra query, so the unhelpful arm costs no I/O.
  const unhelpful = allNotes.filter((n) => n.status === STATUS_NOT_HELPFUL);

  return {
    helpfulNotes: helpful.slice(0, MAX_NOTES_IN_PROMPT).map(toAuthorNote),
    totalHelpful: helpful.length,
    unhelpfulNotes: unhelpful.slice(0, MAX_NOTES_IN_PROMPT).map(toAuthorNote),
    totalUnhelpful: unhelpful.length,
  };
}

function toAuthorNote(n: { tweetText: string; noteText: string }): AuthorNote {
  return { tweetText: n.tweetText, noteText: n.noteText };
}
