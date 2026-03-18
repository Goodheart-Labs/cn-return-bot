import axios from "axios";
import { getOAuth1Headers } from "./getOAuthToken";

export type ReferencedTweet = {
  type: "retweeted" | "quoted" | "replied_to";
  id: string;
};

export type ReferencedTweetData = {
  id: string;
  author_id: string;
  created_at: string;
  text: string;
  media?: any[];
};

export type TweetPublicMetrics = {
  impression_count?: number;
  like_count?: number;
  retweet_count?: number;
  reply_count?: number;
  quote_count?: number;
  bookmark_count?: number;
};

export type Post = {
  id: string;
  author_id: string;
  created_at: string;
  text: string;
  media: any[];
  referenced_tweets?: ReferencedTweet[];
  referenced_tweet_data?: ReferencedTweetData;
  public_metrics?: TweetPublicMetrics;
  author_followers?: number;
};

export async function fetchEligiblePosts(
  maxResults: number = 10,
  skipPostIds: Set<string> = new Set(),
  maxPages: number = 3
): Promise<Post[]> {
  const allEligiblePosts: Post[] = [];
  const seenPostIds = new Set<string>(skipPostIds); // Track all seen post IDs to prevent duplicates
  let nextToken: string | undefined;
  let pageCount = 0;
  let totalDuplicatesSkipped = 0;

  while (pageCount < maxPages && allEligiblePosts.length < maxResults) {
    pageCount++;

    // Fetch more posts than needed to account for skipped ones
    const fetchMultiplier = skipPostIds.size > 0 ? 3 : 1;
    const fetchLimit = Math.min(maxResults * fetchMultiplier, 100);

    const url = "https://api.x.com/2/notes/search/posts_eligible_for_notes";
    const params = new URLSearchParams({
      max_results: fetchLimit.toString(),
      "tweet.fields": "created_at,author_id,referenced_tweets,public_metrics",
      "media.fields":
        "type,url,preview_image_url,height,width,duration_ms,public_metrics,variants",
      "user.fields": "public_metrics",
      expansions: "attachments.media_keys,referenced_tweets.id,author_id",
      test_mode: "false",
    });

    // Add pagination token if we have one
    if (nextToken) {
      params.append("pagination_token", nextToken);
    }

    const fullUrl = `${url}?${params.toString()}`;

    const response = await axios.get(fullUrl, {
      headers: {
        ...getOAuth1Headers(fullUrl, "GET"),
        "Content-Type": "application/json",
      },
      timeout: 30000, // 30 second timeout to prevent hanging
    });

    const allPosts = parsePostsResponse(response.data);

    // Filter out posts that have already been processed or seen
    let pageDuplicates = 0;
    const newPosts = allPosts.filter((post) => {
      if (seenPostIds.has(post.id)) {
        pageDuplicates++;
        return false;
      }
      seenPostIds.add(post.id);
      return true;
    });
    totalDuplicatesSkipped += pageDuplicates;

    // Add new eligible posts to our collection
    allEligiblePosts.push(...newPosts);

    // Get next token for pagination
    nextToken = response.data.meta?.next_token;

    console.log(
      `[fetchEligiblePosts] Page ${pageCount}: found ${allPosts.length} total posts, ${newPosts.length} new eligible posts`
    );

    // If no more pages, break
    if (!nextToken) {
      console.log(`[fetchEligiblePosts] No more pages available`);
      break;
    }
  }

  console.log(
    `[generate] Fetched ${allEligiblePosts.length} eligible posts across ${pageCount} pages (${totalDuplicatesSkipped} duplicates skipped)`
  );

  // Return only the requested number of posts
  return allEligiblePosts.slice(0, maxResults);
}

export function parsePostsResponse(data: any): Post[] {
  const posts: Post[] = [];
  const mediaMap = new Map<string, any>();
  const referencedTweetsMap = new Map<string, any>();
  const userMap = new Map<string, any>();

  if (data.includes?.media) {
    for (const media of data.includes.media) {
      mediaMap.set(media.media_key, media);
    }
  }

  if (data.includes?.tweets) {
    for (const tweet of data.includes.tweets) {
      referencedTweetsMap.set(tweet.id, tweet);
    }
  }

  if (data.includes?.users) {
    for (const user of data.includes.users) {
      userMap.set(user.id, user);
    }
  }

  if (data.data) {
    for (const tweet of data.data) {
      const media = [];
      if (tweet.attachments?.media_keys) {
        for (const mediaKey of tweet.attachments.media_keys) {
          const mediaData = mediaMap.get(mediaKey);
          if (mediaData) {
            media.push({
              media_key: mediaData.media_key,
              type: mediaData.type,
              url: mediaData.url,
              preview_image_url: mediaData.preview_image_url,
              height: mediaData.height,
              width: mediaData.width,
              duration_ms: mediaData.duration_ms,
              view_count: mediaData.public_metrics?.view_count,
              variants: mediaData.variants,
            });
          }
        }
      }
      // Get referenced tweet data if this is a retweet or quoted tweet
      let referencedTweetData: ReferencedTweetData | undefined;
      if (tweet.referenced_tweets?.length > 0) {
        const referencedTweet = tweet.referenced_tweets.find(
          (rt: any) => rt.type === "retweeted" || rt.type === "quoted"
        );
        if (referencedTweet) {
          const referencedData = referencedTweetsMap.get(referencedTweet.id);
          if (referencedData) {
            // Resolve media keys for the referenced tweet
            const refMedia = [];
            if (referencedData.attachments?.media_keys) {
              for (const mediaKey of referencedData.attachments.media_keys) {
                const mediaData = mediaMap.get(mediaKey);
                if (mediaData) {
                  refMedia.push({
                    media_key: mediaData.media_key,
                    type: mediaData.type,
                    url: mediaData.url,
                    preview_image_url: mediaData.preview_image_url,
                    height: mediaData.height,
                    width: mediaData.width,
                    duration_ms: mediaData.duration_ms,
                    view_count: mediaData.public_metrics?.view_count,
                    variants: mediaData.variants,
                  });
                }
              }
            }
            referencedTweetData = {
              id: referencedData.id,
              author_id: referencedData.author_id,
              created_at: referencedData.created_at,
              text: referencedData.text,
              media: refMedia,
            };
          }
        }
      }

      // Extract author follower count from user expansion
      const authorData = userMap.get(tweet.author_id);
      const authorFollowers = authorData?.public_metrics?.followers_count;

      posts.push({
        id: tweet.id,
        author_id: tweet.author_id,
        created_at: tweet.created_at,
        text: tweet.text,
        media,
        referenced_tweets: tweet.referenced_tweets || undefined,
        referenced_tweet_data: referencedTweetData,
        public_metrics: tweet.public_metrics,
        author_followers: authorFollowers,
      });
    }
  }
  return posts;
}
