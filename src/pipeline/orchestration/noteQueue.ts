/**
 * The note queue: finished notes wait here until X has room for them.
 *
 * A note X has no room for stays a candidate and is marked
 * outcome_reason "queued". Each run loads the marked rows, adds its fresh
 * notes, and submits the lot in note-rater order until X refuses. A queued note
 * expires QUEUE_MAX_AGE_HOURS after it was written; the 24h stale-tweet cutoff
 * in submitCandidates still applies on top.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import { isAboveVelocityFloor } from "../utils/velocity";
import { partitionByStaleCutoff } from "./submitCandidates";
import type { Candidate } from "./submitCandidates";
import { orderForSubmit } from "../ranking/submitOrder";
import { raterPriority, rateCandidate, noteRaterEnabled, type NoteRating } from "../score/noteRater";
import type { SupabaseLogger } from "../../api/supabaseClient";

// The queue orders by the rater, so it needs the rater on. Switch the queue
// off alone with the repo variable NOTE_QUEUE_ENABLED=false.
export function noteQueueEnabled(): boolean {
  return noteRaterEnabled() && process.env.NOTE_QUEUE_ENABLED !== "false";
}

// Notes do about as well on tweets up to ~12h old at submit and worse after.
export const QUEUE_MAX_AGE_HOURS = 12;
// A run re-rates at most this many queued notes whose first rating failed.
export const MAX_RERATES_PER_RUN = 10;

/** Rated notes first, best first; unrated notes after them in their old order. */
export function orderByRater(candidates: Candidate[]): Candidate[] {
  return orderForSubmit(candidates, (c) => (c.rating ? raterPriority(c.rating) : -Infinity));
}

/** The columns of a `tweets` row that a Post needs. */
export interface QueuedTweetRow {
  tweet_id: string;
  author_id: string | null;
  author_name: string | null;
  author_description: string | null;
  author_followers: number | null;
  author_tweet_count: number | null;
  text: string | null;
  posted_at: string | null;
  impressions: number | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  quotes: number | null;
  bookmarks: number | null;
  media: Post["media"] | null;
  referenced_tweets: Post["referenced_tweets"] | null;
  referenced_tweet_data: Post["referenced_tweet_data"] | null;
}

export interface QueuedRun {
  id: string;
  tweet_id: string;
  note_text: string | null;
  source_url: string | null;
  bot_name: string | null;
  created_at: string;
  velocity: number | null;
  evaluationScore: number | null;
  tweet: QueuedTweetRow | null;
  rating: NoteRating | null;
}

/** The inverse of postToTweetRow in supabaseClient. */
export function tweetRowToPost(row: QueuedTweetRow): Post {
  return {
    id: row.tweet_id,
    author_id: row.author_id ?? "",
    created_at: row.posted_at ?? "",
    text: row.text ?? "",
    media: row.media ?? [],
    referenced_tweets: row.referenced_tweets ?? undefined,
    referenced_tweet_data: row.referenced_tweet_data ?? undefined,
    public_metrics: {
      impression_count: row.impressions ?? undefined,
      like_count: row.likes ?? undefined,
      retweet_count: row.retweets ?? undefined,
      reply_count: row.replies ?? undefined,
      quote_count: row.quotes ?? undefined,
      bookmark_count: row.bookmarks ?? undefined,
    } as Post["public_metrics"],
    author_followers: row.author_followers ?? undefined,
    author_name: row.author_name ?? undefined,
    author_description: row.author_description ?? undefined,
    author_tweet_count: row.author_tweet_count ?? undefined,
  };
}

/** Rebuilds a submittable Candidate from a queued pipeline_runs row. Returns
 *  null when the row has no note text. A missing tweets row leaves a bare post;
 *  submission needs only its id, and the stale cutoff reads the id's timestamp. */
export function candidateFromQueuedRun(run: QueuedRun): Candidate | null {
  if (!run.note_text || !run.note_text.trim()) return null;
  const post: Post = run.tweet
    ? tweetRowToPost(run.tweet)
    : { id: run.tweet_id, author_id: "", created_at: "", text: "", media: [] };
  return {
    post,
    botId: run.bot_name ?? "simple-bot",
    velocity: run.velocity,
    rating: run.rating,
    queuedAt: run.created_at,
    sourceUrl: run.source_url ?? undefined,
    tweetResult: {
      pipelineResult: null,
      outcome: "candidate",
      finalStage: "candidate",
      noteText: run.note_text,
      pipelineRunId: run.id,
      evaluationScore: run.evaluationScore ?? undefined,
      scores: [],
    },
  };
}

/** The queued notes that submitCandidates would actually send: in time, above
 *  the velocity floor, and not below the bar (an unrated note is never below it). */
export function submittableQueued(queued: Candidate[], bar: number | null): Candidate[] {
  return partitionByStaleCutoff(queued).kept.filter((c) =>
    isAboveVelocityFloor(c.velocity ?? null) && (bar === null || !c.rating || raterPriority(c.rating) >= bar));
}

/** Drops queued candidates whose run is already among this run's fresh ones. */
export function mergeWithQueue(fresh: Candidate[], queued: Candidate[]): Candidate[] {
  const freshRuns = new Set(fresh.map((c) => c.tweetResult.pipelineRunId));
  const freshTweets = new Set(fresh.map((c) => c.post.id));
  return [
    ...fresh,
    ...queued.filter((q) => !freshRuns.has(q.tweetResult.pipelineRunId) && !freshTweets.has(q.post.id)),
  ];
}

/** Closes expired queue rows, loads the rest, and re-rates any whose first
 *  rating failed. Returns them ready to merge with this run's fresh notes. */
export async function loadNoteQueue(logger: SupabaseLogger): Promise<Candidate[]> {
  try {
    const expired = await logger.expireQueuedRuns(QUEUE_MAX_AGE_HOURS);
    if (expired > 0) console.log(`[noteQueue] ${expired} queued note(s) expired after ${QUEUE_MAX_AGE_HOURS}h`);
  } catch (err) {
    console.warn("[noteQueue] could not expire old queue rows (continuing):", err);
  }
  const runs = await logger.fetchQueuedRuns(QUEUE_MAX_AGE_HOURS);
  const candidates = runs.map(candidateFromQueuedRun).filter((c): c is Candidate => c !== null);
  const unrated = candidates.filter((c) => !c.rating && c.post.text).slice(0, MAX_RERATES_PER_RUN);
  await Promise.all(unrated.map(async (c) => {
    c.rating = await rateCandidate(logger, { tweetId: c.post.id, postText: c.post.text ?? "", noteText: c.tweetResult.noteText, sourceUrl: c.sourceUrl, pipelineRunId: c.tweetResult.pipelineRunId });
  }));
  console.log(`[noteQueue] ${candidates.length} note(s) waiting in the queue` + (unrated.length ? ` (${unrated.length} re-rated)` : ""));
  return candidates;
}
