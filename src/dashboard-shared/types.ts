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
