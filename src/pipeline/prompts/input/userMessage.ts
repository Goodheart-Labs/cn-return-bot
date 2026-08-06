/**
 * Prompt — shared bot user message.
 *
 * Renders the post (with author, engagement, media, comments, and prior
 * corrections to the author) into the user message every bot's pipeline reads.
 * `buildUserMessage` stays available for callers (e.g. eval harnesses) that
 * assemble media from somewhere other than a `BotInput`.
 */

import type { Post } from "../../../api/fetchEligiblePosts";
import type { GeminiMediaItem } from "../../media/mediaAnalysisGemini";
import type { AuthorNote, AuthorNoteHistory } from "../../input/authorHistory";
import type { BotInput } from "../../input/createBotInput";
import { getBotConfig } from "../../ab-testing/botConfig";

type ReferenceKind = "quoted" | "retweeted";

// X's standard post limit, so an ordinary post is quoted whole. Longer
// (Premium) posts still get cut — 23% of noted posts run past it — but the
// opening is enough to place the topic, which is all this block is for.
const MAX_HISTORY_POST_CHARS = 280;
// Notes run to ~930 chars, so this does cut most of them. The claim leads and
// the sources trail, so what's lost is mostly URLs we don't want copied anyway.
const MAX_HISTORY_NOTE_CHARS = 300;

function formatAuthorNotes(notes: AuthorNote[], noteLabel: string): string[] {
  return notes.flatMap((n, i) => [
    `${i + 1}. Post: "${n.tweetText.slice(0, MAX_HISTORY_POST_CHARS)}"`,
    `   ${noteLabel}: "${n.noteText.slice(0, MAX_HISTORY_NOTE_CHARS)}"`,
  ]);
}

function getReferenceKind(post: Post): ReferenceKind | undefined {
  if (!post.referenced_tweet_data) return undefined;
  const ref = post.referenced_tweets?.find(
    (rt) => rt.type === "quoted" || rt.type === "retweeted",
  );
  return ref?.type as ReferenceKind | undefined;
}

export function buildUserMessage(params: {
  post: Post;
  tweetMedia: GeminiMediaItem[];
  quotedTweetMedia: GeminiMediaItem[];
  authorNoteHistory?: AuthorNoteHistory;
  /** Also show the author's rejected notes — the `on_with_unhelpful` A/B arm. */
  showUnhelpfulHistory?: boolean;
  comments?: string;
  mediaMadeWithAiLabel?: boolean;
}): string {
  const { post } = params;
  const now = new Date();
  const parts: string[] = [];

  // Timestamps
  parts.push(`Current date: ${now.toISOString().split("T")[0]}`);
  parts.push(`Current time: ${now.toISOString().split("T")[1]!.slice(0, 5)} UTC`);
  parts.push(`Tweet posted: ${post.created_at}`);
  // Pre-computed age (timing_context arm): the timing machinery turns on the
  // post's age, and models are unreliable at timestamp arithmetic — hand them
  // the operative number. Gated on the same flag so the A/B arms stay clean.
  if (getBotConfig().timing_context && post.created_at) {
    const ageMs = now.getTime() - Date.parse(post.created_at);
    if (Number.isFinite(ageMs) && ageMs >= 0) {
      parts.push(`Post age: ${(ageMs / 3_600_000).toFixed(1)} hours`);
    }
  }
  // Only real (numeric) tweet ids form a valid URL. Synthetic posts — e.g. the
  // everything pipeline's `${itemId}-${index}` claim ids — would otherwise emit
  // a bogus link that confuses the model, so omit it for them.
  if (/^\d+$/.test(post.id)) parts.push(`Tweet URL: https://x.com/i/status/${post.id}`);

  // Author info
  const authorParts: string[] = [];
  if (post.author_name) authorParts.push(post.author_name);
  if (post.author_followers != null) authorParts.push(`${post.author_followers.toLocaleString()} followers`);
  if (post.author_tweet_count != null) authorParts.push(`${post.author_tweet_count.toLocaleString()} posts`);
  if (authorParts.length) parts.push(`\nAuthor: ${authorParts.join(" — ")}`);
  if (post.author_description) parts.push(`Author bio: ${post.author_description}`);

  // Engagement metrics
  const m = post.public_metrics;
  if (m) {
    const metricParts: string[] = [];
    if (m.impression_count != null) metricParts.push(`${m.impression_count.toLocaleString()} impressions`);
    if (m.like_count != null) metricParts.push(`${m.like_count.toLocaleString()} likes`);
    if (m.retweet_count != null) metricParts.push(`${m.retweet_count.toLocaleString()} retweets`);
    if (m.reply_count != null) metricParts.push(`${m.reply_count.toLocaleString()} replies`);
    if (m.quote_count != null) metricParts.push(`${m.quote_count.toLocaleString()} quotes`);
    if (metricParts.length) parts.push(`Engagement: ${metricParts.join(" — ")}`);
  }

  // Author note history
  const history = params.authorNoteHistory;
  if (history && history.totalHelpful > 0) {
    parts.push(
      `\n## Past corrections to this author's posts (${history.totalHelpful} helpful community notes on record)\n`,
    );
    parts.push(...formatAuthorNotes(history.helpfulNotes, "Correction"));
  }
  // Optional-chained because runs logged before this arm existed replay without
  // the field.
  if (params.showUnhelpfulHistory && history?.unhelpfulNotes?.length) {
    parts.push(
      `\n## Past notes on this author's posts that raters REJECTED (${history.totalUnhelpful} rated not helpful vs ${history.totalHelpful} rated helpful on record)\n`,
    );
    parts.push(
      `Raters saw these notes and voted them down. Ask why before noting this post: the author may write satire, opinion, or commentary that reads as a factual claim but that raters do not think needs correcting. One rejection is weak evidence; several with no helpful notes is strong evidence a note here would be rejected too.\n`,
    );
    parts.push(...formatAuthorNotes(history.unhelpfulNotes, "Note rated not helpful"));
  }

  // Post + referenced post
  // For retweets, post.text is "RT @user: <truncated>" — show only the original.
  // For quote tweets, show the user's commentary AND the quoted post separately.
  const refKind = getReferenceKind(post);
  if (refKind === "retweeted") {
    parts.push(`\n## Post (retweet)\n\n${post.referenced_tweet_data!.text}`);
  } else {
    parts.push(`\n## Post\n\n${post.text}`);
    if (refKind === "quoted") {
      parts.push(`\n## Quoted post\n\n${post.referenced_tweet_data!.text}`);
    }
  }

  // Media on post
  if (params.tweetMedia.length) {
    parts.push(`\n## Media on post`);
    parts.push(formatMediaItems(params.tweetMedia));
  }

  // Media on quoted/retweeted post
  if (params.quotedTweetMedia.length) {
    const heading = refKind === "retweeted" ? "Media on retweeted post" : "Media on quoted post";
    parts.push(`\n## ${heading}`);
    parts.push(formatMediaItems(params.quotedTweetMedia));
  }

  // X's synthetic-media provenance label, scraped from the post page.
  if (params.mediaMadeWithAiLabel) {
    parts.push(`\nMedia was tagged with "Made with AI" on x.com`);
  }

  // Comments and replies
  if (params.comments) {
    parts.push(`\n## Comments and replies\n\n${params.comments}`);
  }

  return parts.join("\n");
}

/**
 * Render the user message for the bots' shared `BotInput`. Resolves the
 * author-history arm here rather than at lookup time so a cached `BotInput`
 * (big_eval's input cache) carries the full history and serves every arm.
 */
export function buildUserMessageFromInput(post: Post, input: BotInput): string {
  return buildUserMessage({
    post,
    tweetMedia: input.mediaResult.tweetMedia,
    quotedTweetMedia: input.mediaResult.quotedTweetMedia,
    authorNoteHistory: input.authorHistory,
    showUnhelpfulHistory: getBotConfig().author_history_unhelpful,
    comments: input.comments,
    mediaMadeWithAiLabel: input.mediaMadeWithAiLabel,
  });
}

function formatMediaItems(items: GeminiMediaItem[]): string {
  const parts: string[] = [];
  let imageIdx = 0;
  let videoIdx = 0;

  for (const item of items) {
    if (item.type === "image") {
      imageIdx++;
      parts.push(`\n### Image ${imageIdx}`);
    } else {
      videoIdx++;
      parts.push(`\n### Video ${videoIdx}`);
    }

    if (item.description.description) {
      parts.push(`Description: ${item.description.description}`);
    }
    if (item.description.ocrText) {
      parts.push(`Visible text: ${item.description.ocrText}`);
    }
    if (item.type === "video") {
      parts.push(`Audio transcript: ${item.transcription || "(unavailable)"}`);
    } else if (item.transcription) {
      parts.push(`Audio transcript: ${item.transcription}`);
    }
  }

  return parts.join("\n");
}
