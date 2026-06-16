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
import type { AuthorNoteHistory } from "../../input/authorHistory";
import type { BotInput } from "../../input/createBotInput";

type ReferenceKind = "quoted" | "retweeted";

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
  parts.push(`Tweet URL: https://x.com/i/status/${post.id}`);

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
  if (params.authorNoteHistory && params.authorNoteHistory.totalHelpful > 0) {
    const h = params.authorNoteHistory;
    parts.push(`\n## Past corrections to this author's posts (${h.totalHelpful} helpful community notes on record)\n`);
    for (let i = 0; i < h.helpfulNotes.length; i++) {
      const n = h.helpfulNotes[i]!;
      parts.push(`${i + 1}. Post: "${n.tweetText.slice(0, 200)}"`);
      parts.push(`   Correction: "${n.noteText.slice(0, 300)}"`);
    }
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

/** Render the user message for the bots' shared `BotInput`. */
export function buildUserMessageFromInput(post: Post, input: BotInput): string {
  return buildUserMessage({
    post,
    tweetMedia: input.mediaResult.tweetMedia,
    quotedTweetMedia: input.mediaResult.quotedTweetMedia,
    authorNoteHistory: input.authorHistory,
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
