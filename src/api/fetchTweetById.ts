import axios from "axios";
import { getOAuth1Headers } from "./getOAuthToken";
import { parsePostsResponse, type Post } from "./fetchEligiblePosts";

/**
 * Fetch a single tweet by ID using X API v2.
 * Uses the same fields/expansions as fetchEligiblePosts for consistent Post shape.
 */
export async function fetchTweetById(tweetId: string): Promise<Post> {
  const params = new URLSearchParams({
    "tweet.fields": "created_at,author_id,referenced_tweets,public_metrics",
    "media.fields": "type,url,preview_image_url,height,width,duration_ms,public_metrics,variants",
    "user.fields": "public_metrics",
    expansions: "attachments.media_keys,referenced_tweets.id,author_id",
  });

  const fullUrl = `https://api.x.com/2/tweets/${tweetId}?${params.toString()}`;

  const response = await axios.get(fullUrl, {
    headers: {
      ...getOAuth1Headers(fullUrl, "GET"),
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });

  const posts = parsePostsResponse(response.data);

  if (posts.length === 0) {
    throw new Error(`Tweet ${tweetId} not found or inaccessible`);
  }

  return posts[0]!;
}
