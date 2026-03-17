import type { Post } from "../api/fetchEligiblePosts";

import type { MediaItem } from "../bots/types";

export function getOriginalTweetContent(post: Post): {
  text: string;
  media: string[];
  mediaItems?: MediaItem[];
  isQuoteTweet: boolean;
  quotedPostContext?: string;
} {
  // Check if this post has a referenced tweet of type 'retweeted'
  const retweetRef = post.referenced_tweets?.find((rt) => rt.type === "retweeted");
  // Check if this post has a referenced tweet of type 'quoted'
  const quotedRef = post.referenced_tweets?.find((rt) => rt.type === "quoted");

  if (retweetRef && post.referenced_tweet_data) {
    // This is a retweet, return the original tweet content
    const refMedia = post.referenced_tweet_data.media || [];
    return {
      text: post.referenced_tweet_data.text,
      media: refMedia.map((m) => m.url || m.preview_image_url).filter(Boolean),
      mediaItems: refMedia.map((m) => ({
        type: m.type,
        url: m.url,
        preview_image_url: m.preview_image_url,
        variants: m.variants,
        duration_ms: m.duration_ms,
      })),
      isQuoteTweet: false,
      quotedPostContext: `This community note is about a post that was retweeted. The original tweet content is: "${post.referenced_tweet_data.text}"`,
    };
  }

  if (quotedRef && post.referenced_tweet_data) {
    // This is a quoted tweet, combine both the quote and the original content
    const combinedText = `${post.text}\n\nQuoted tweet: "${post.referenced_tweet_data.text}"`;
    const allMedia = [...(post.media || []), ...(post.referenced_tweet_data.media || [])];
    return {
      text: combinedText,
      media: allMedia.map((m) => m.url || m.preview_image_url).filter(Boolean),
      mediaItems: allMedia.map((m) => ({
        type: m.type,
        url: m.url,
        preview_image_url: m.preview_image_url,
        variants: m.variants,
        duration_ms: m.duration_ms,
      })),
      isQuoteTweet: true,
      quotedPostContext: `This community note is about a quoted tweet. The user's comment is: "${post.text}" and they are quoting: "${post.referenced_tweet_data.text}"`,
    };
  }

  // Check if this looks like a traditional retweet (RT @username: ...)
  if (post.text.startsWith("RT @")) {
    const rtMatch = post.text.match(/^RT @\w+: (.+)$/);
    if (rtMatch && rtMatch[1]) {
      const originalText = rtMatch[1];
      return {
        text: originalText, // Extract the original tweet text after "RT @username: "
        media: post.media?.map((m) => m.url || m.preview_image_url).filter(Boolean) || [],
        mediaItems:
          post.media?.map((m) => ({
            type: m.type,
            url: m.url,
            preview_image_url: m.preview_image_url,
            variants: m.variants,
            duration_ms: m.duration_ms,
          })) || [],
        isQuoteTweet: false,
        quotedPostContext: `This community note is about a post that was retweeted. The original tweet content is: "${originalText}"`,
      };
    }
  }

  // Not a retweet, return the original content
  return {
    text: post.text,
    media: post.media?.map((m) => m.url || m.preview_image_url).filter(Boolean) || [],
    mediaItems:
      post.media?.map((m) => ({
        type: m.type,
        url: m.url,
        preview_image_url: m.preview_image_url,
        variants: m.variants,
        duration_ms: m.duration_ms,
      })) || [],
    isQuoteTweet: false,
  };
}
