/**
 * Prompt — shared bot user message.
 *
 * This file renders a post into the user message that every bot's pipeline
 * reads. The rendering covers the author, the engagement numbers, the media, the
 * comments, and the corrections written on this author's earlier posts.
 * `buildUserMessage` stays exported for callers that assemble their media
 * somewhere other than a `BotInput`, such as the eval harnesses.
 */

import type { Post } from "../../../api/fetchEligiblePosts";
import type { GeminiMediaItem } from "../../media/mediaAnalysisGemini";
import type { AuthorNote, AuthorNoteHistory } from "../../input/authorHistory";
import type { BotInput } from "../../input/createBotInput";
import { getBotConfig } from "../../ab-testing/botConfig";

type ReferenceKind = "quoted" | "retweeted";

// This is X's standard post limit, so an ordinary post is quoted whole. Longer
// Premium posts still get cut, and 23% of the posts we note run past the limit.
// The opening is enough to place the topic, which is all this block is for.
const MAX_HISTORY_POST_CHARS = 280;
// Notes run to about 930 characters, so this limit does cut most of them. The
// claim comes first and the sources come last. What gets lost is mostly source
// URLs, which we do not want the model copying anyway.
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
  /** Also show the notes on this author that raters rejected. This is the
   *  `on_with_unhelpful` A/B arm. */
  showUnhelpfulHistory?: boolean;
  comments?: string;
  mediaMadeWithAiLabel?: boolean;
}): string {
  const { post } = params;
  const now = new Date();
  const parts: string[] = [];

  parts.push(`Current date: ${now.toISOString().split("T")[0]}`);
  parts.push(`Current time: ${now.toISOString().split("T")[1]!.slice(0, 5)} UTC`);
  parts.push(`Tweet posted: ${post.created_at}`);
  // The timing machinery turns on how old the post is, and models are unreliable
  // at timestamp arithmetic. So we work the age out here and hand them the
  // number. It is gated on the timing_context flag, the same flag the timing
  // stage uses, so the A/B arms stay clean.
  if (getBotConfig().timing_context && post.created_at) {
    const ageMs = now.getTime() - Date.parse(post.created_at);
    if (Number.isFinite(ageMs) && ageMs >= 0) {
      parts.push(`Post age: ${(ageMs / 3_600_000).toFixed(1)} hours`);
    }
  }
  // Only a real numeric tweet id forms a valid URL. Synthetic posts would
  // produce a bogus link that confuses the model, so we leave the URL out for
  // them. The everything pipeline's claim ids are such synthetic posts, since
  // they are built as an item id followed by an index.
  if (/^\d+$/.test(post.id)) parts.push(`Tweet URL: https://x.com/i/status/${post.id}`);

  const authorParts: string[] = [];
  if (post.author_name) authorParts.push(post.author_name);
  if (post.author_followers != null) authorParts.push(`${post.author_followers.toLocaleString()} followers`);
  if (post.author_tweet_count != null) authorParts.push(`${post.author_tweet_count.toLocaleString()} posts`);
  if (authorParts.length) parts.push(`\nAuthor: ${authorParts.join(" — ")}`);
  if (post.author_description) parts.push(`Author bio: ${post.author_description}`);

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

  const history = params.authorNoteHistory;
  if (history && history.totalHelpful > 0) {
    parts.push(
      `\n## Past corrections to this author's posts (${history.totalHelpful} helpful community notes on record)\n`,
    );
    parts.push(...formatAuthorNotes(history.helpfulNotes, "Correction"));
  }
  // The optional chaining matters because a run that was logged before this arm
  // existed replays without the field.
  if (params.showUnhelpfulHistory && history?.unhelpfulNotes?.length) {
    parts.push(
      `\n## Past notes on this author's posts that raters REJECTED (${history.totalUnhelpful} rated not helpful vs ${history.totalHelpful} rated helpful on record)\n`,
    );
    parts.push(
      `Raters saw these notes and voted them down. Ask why before noting this post: the author may write satire, opinion, or commentary that reads as a factual claim but that raters do not think needs correcting. One rejection is weak evidence; several with no helpful notes is strong evidence a note here would be rejected too.\n`,
    );
    parts.push(...formatAuthorNotes(history.unhelpfulNotes, "Note rated not helpful"));
  }

  // For a retweet, post.text is "RT @user: <truncated>", so we show only the
  // original post. For a quote tweet, we show the user's own commentary and the
  // quoted post separately.
  const refKind = getReferenceKind(post);
  if (refKind === "retweeted") {
    parts.push(`\n## Post (retweet)\n\n${post.referenced_tweet_data!.text}`);
  } else {
    parts.push(`\n## Post\n\n${post.text}`);
    if (refKind === "quoted") {
      parts.push(`\n## Quoted post\n\n${post.referenced_tweet_data!.text}`);
    }
  }

  if (params.tweetMedia.length) {
    parts.push(`\n## Media on post`);
    parts.push(formatMediaItems(params.tweetMedia));
  }

  if (params.quotedTweetMedia.length) {
    const heading = refKind === "retweeted" ? "Media on retweeted post" : "Media on quoted post";
    parts.push(`\n## ${heading}`);
    parts.push(formatMediaItems(params.quotedTweetMedia));
  }

  // This is X's own provenance label for synthetic media. We scrape it from the
  // post page.
  if (params.mediaMadeWithAiLabel) {
    parts.push(`\nMedia was tagged with "Made with AI" on x.com`);
  }

  if (params.comments) {
    parts.push(`\n## Comments and replies\n\n${params.comments}`);
  }

  return parts.join("\n");
}

/**
 * Renders the user message from the bots' shared `BotInput`. The author-history
 * arm is resolved here rather than when the history is looked up. That way a
 * cached `BotInput` carries the full history and can serve every arm. big_eval's
 * input cache holds such cached inputs.
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
