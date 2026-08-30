// Data layer for the Similarity panel. Reads the precomputed neighbor list from
// the generated JSON (produced by scripts_jim/2026_07_01_tweet_similarity_derisk)
// and fetches the tweets + their community notes (ours + competitors') live from
// Supabase, mirroring the fetch patterns in lib/data.ts.

import { supabase } from "./supabase";
import { fetchInBatches } from "../../../dashboard-shared/supabasePaging";
import type { Tweet } from "../../../dashboard-shared/types";
import similarityResults from "../generated/similarityResults.json";

export interface Neighbor {
  tweetId: string;
  similarity: number;
}
export interface SourceResult {
  tweetId: string;
  text: string;
  postedAt: string | null;
  neighbors: Neighbor[];
}
export interface SimilarityResults {
  generatedAt: string;
  model: string;
  dims: number;
  corpusSize: number;
  corpusWithNotes: number;
  sources: SourceResult[];
}

export const results = similarityResults as SimilarityResults;

export interface NoteView {
  noteId: string;
  noteText?: string;
  status?: string;
  isOurs: boolean;
}
export interface SimilarTweet {
  tweetId: string;
  similarity: number;
  tweet?: Tweet;
  notes: NoteView[];
}

const TWEET_COLS =
  "tweet_id, text, author_handle, has_photo, has_video, media_count, media, referenced_tweet_data";

function rowToTweet(row: any): Tweet {
  return {
    tweetId: row.tweet_id,
    text: row.text ?? undefined,
    handle: row.author_handle ?? undefined,
    hasPhoto: row.has_photo ?? undefined,
    hasVideo: row.has_video ?? undefined,
    mediaCount: row.media_count ?? undefined,
    media: row.media ?? undefined,
    referencedTweetData: row.referenced_tweet_data ?? undefined,
  };
}

async function fetchTweets(ids: string[]): Promise<Map<string, Tweet>> {
  const rows = await fetchInBatches<any>(supabase, "tweets", TWEET_COLS, "tweet_id", ids, undefined, "sim_tweets");
  return new Map(rows.map((r) => [r.tweet_id, rowToTweet(r)]));
}

async function fetchNotes(ids: string[]): Promise<Map<string, NoteView[]>> {
  const [ours, competing] = await Promise.all([
    fetchInBatches<any>(supabase, "notes", "note_id, tweet_id, note_text, cn_status", "tweet_id", ids, undefined, "sim_our_notes"),
    fetchInBatches<any>(supabase, "competing_notes", "note_id, tweet_id, note_text, current_status", "tweet_id", ids, undefined, "sim_competing"),
  ]);
  const byTweet = new Map<string, NoteView[]>();
  const push = (tweetId: string, note: NoteView) => {
    const arr = byTweet.get(tweetId) ?? [];
    arr.push(note);
    byTweet.set(tweetId, arr);
  };
  for (const n of ours) {
    if (!n.note_text) continue;
    push(n.tweet_id, { noteId: n.note_id, noteText: n.note_text, status: n.cn_status, isOurs: true });
  }
  for (const c of competing) {
    if (!c.note_text) continue;
    push(c.tweet_id, { noteId: c.note_id, noteText: c.note_text, status: c.current_status, isOurs: false });
  }
  return byTweet;
}

/** Fetch the source tweet (for the left panel) + all neighbor tweets with their notes. */
export async function loadSource(source: SourceResult): Promise<{ source?: Tweet; similar: SimilarTweet[] }> {
  const neighborIds = source.neighbors.map((n) => n.tweetId);
  const [tweetsById, notesByTweet] = await Promise.all([
    fetchTweets([source.tweetId, ...neighborIds]),
    fetchNotes(neighborIds),
  ]);
  const similar = source.neighbors.map((n) => ({
    tweetId: n.tweetId,
    similarity: n.similarity,
    tweet: tweetsById.get(n.tweetId),
    notes: notesByTweet.get(n.tweetId) ?? [],
  }));
  return { source: tweetsById.get(source.tweetId), similar };
}
