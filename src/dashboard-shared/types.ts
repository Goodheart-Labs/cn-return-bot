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
  // External source link. When set (dataset-run items), it drives the
  // "View on <domain>" link directly — e.g. a timestamped YouTube URL for
  // podcast items. When unset, the link falls back to the X status URL.
  sourceUrl?: string;
  text?: string;
  handle?: string;
  hasPhoto?: boolean;
  hasVideo?: boolean;
  mediaCount?: number;
  media?: TweetMediaItem[];
  referencedTweetData?: ReferencedTweetData;
}

/** A piece of noted content, rendered by ContentCard: an X post, a YouTube
 *  clip (embedded at its timestamp span), or a citation from an article. */
export type NotedContent =
  | { kind: "tweet"; tweet: Tweet }
  | { kind: "youtube"; url: string; quote?: string; fragmentText?: string; startSeconds?: number | null; endSeconds?: number | null }
  | { kind: "article"; url: string | null; quote: string; fragmentText?: string };

export interface PublicDumpRatings {
  helpful_count: number;
  somewhat_helpful_count: number;
  not_helpful_count: number;
  helpful_tag_counts: Record<string, number>;
  not_helpful_tag_counts: Record<string, number>;
  dump_date: string;
}
