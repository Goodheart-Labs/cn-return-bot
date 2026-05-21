export interface TweetMediaItem {
  type: string;
  url?: string;
  preview_image_url?: string;
  [k: string]: unknown;
}

export interface ReferencedTweetData {
  text?: string;
  media?: TweetMediaItem[];
}

export interface Tweet {
  tweetId: string;
  text?: string;
  handle?: string;
  hasPhoto?: boolean;
  hasVideo?: boolean;
  mediaCount?: number;
  media?: TweetMediaItem[];
  referencedTweetData?: ReferencedTweetData;
}

export interface PublicDumpRatings {
  helpful_count: number;
  somewhat_helpful_count: number;
  not_helpful_count: number;
  helpful_tag_counts: Record<string, number>;
  not_helpful_tag_counts: Record<string, number>;
  dump_date: string;
}
