import type { MediaVariant } from "../pipeline/media/bestMediaUrl";

export interface TweetMediaItem {
  type: string;
  url?: string;
  preview_image_url?: string;
  variants?: MediaVariant[];
  [k: string]: unknown;
}

export interface ReferencedTweetData {
  text?: string;
  media?: TweetMediaItem[];
}

export interface Tweet {
  tweetId: string;
  // A link to the content outside X. Items from a dataset run set it, and then
  // it is what the "View on <domain>" link points at. A podcast item, for
  // example, sets a timestamped YouTube URL. When it is unset, the link falls
  // back to the post's URL on X.
  sourceUrl?: string;
  text?: string;
  handle?: string;
  hasPhoto?: boolean;
  hasVideo?: boolean;
  mediaCount?: number;
  media?: TweetMediaItem[];
  referencedTweetData?: ReferencedTweetData;
}

/** A piece of content that a note was written about, rendered by ContentCard. It
 *  is either an X post, a YouTube clip embedded at its timestamp span, or a
 *  citation from an article. */
export type NotedContent =
  | { kind: "tweet"; tweet: Tweet }
  | { kind: "youtube"; url: string; quote?: string; fragmentText?: string; updatedQuote?: string; imageGrounded?: boolean; startSeconds?: number | null; endSeconds?: number | null }
  | { kind: "article"; url: string | null; quote: string; fragmentText?: string; updatedQuote?: string; imageGrounded?: boolean };

export interface PublicDumpRatings {
  helpful_count: number;
  somewhat_helpful_count: number;
  not_helpful_count: number;
  helpful_tag_counts: Record<string, number>;
  not_helpful_tag_counts: Record<string, number>;
  dump_date: string;
}
