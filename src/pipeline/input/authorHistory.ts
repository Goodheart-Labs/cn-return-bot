/**
 * Author Note History
 *
 * Looks up past community notes on a given author's posts. It finds the author's
 * tweets by tweets.author_id, then reads the notes and competing_notes tables for
 * those tweets. It gathers both the notes raters found helpful and the ones they
 * rejected. The rejected ones only reach the model under the `on_with_unhelpful`
 * A/B arm.
 */

import { getSupabaseClient } from "../../api/supabaseClient";

export interface AuthorNote {
  tweetText: string;
  noteText: string;
}

/**
 * Past notes on an author's posts. We always gather both kinds. The A/B config
 * decides at render time which kind reaches the model, so one cached BotInput
 * serves every arm.
 * Runs logged before the unhelpful arm existed carry no `unhelpfulNotes` and no
 * `totalUnhelpful`. Read those two fields defensively when replaying such a run.
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

  // Find this author's past tweets and their text. The author_id column moved
  // from pipeline_runs to the tweets table in migration 033. The index
  // idx_tweets_author_id is what makes this lookup cheap.
  const { data: authorTweets, error: tweetsError } = await supabase
    .from("tweets")
    .select("tweet_id, text")
    .eq("author_id", authorId)
    .limit(500);

  if (tweetsError || !authorTweets?.length) return EMPTY;

  const tweetTextById = new Map(authorTweets.map((t) => [t.tweet_id, t.text]));
  const tweetIds = [...tweetTextById.keys()];

  // Our notes on this author's tweets. We read cn_status, which is the overall
  // status. The current_core_status column would miss every note that only the
  // expansion or group submodels rated helpful.
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

  // Competing notes on this author's tweets. We query by tweet_id rather than by
  // our_note_id, so that we also see helpful notes on tweets we never noted
  // ourselves. Those rows have our_note_id set to null, and updateNoteFeedback
  // records them from the public Community Notes dump. Querying by our_note_id
  // would only find competing notes attached to our own notes, and would miss the
  // rest of the author's helpful-note history.
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

  // Combine both sources, with our own notes first. When we later trim to
  // MAX_NOTES_IN_PROMPT the notes we wrote are the ones that survive. A rejection
  // of one of our own notes is the sharpest warning we can show the model.
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
  // This filters the rows we already have, so the unhelpful arm costs no extra query.
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
