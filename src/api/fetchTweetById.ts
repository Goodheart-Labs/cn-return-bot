import axios from "axios";
import { getOAuth1Headers } from "./getOAuthToken";
import { parsePostsResponse, POST_API_FIELD_PARAMS, type Post } from "./fetchEligiblePosts";

/**
 * Fetch a single tweet by ID using X API v2.
 * Uses the same fields/expansions as fetchEligiblePosts for an identical Post
 * shape (including the full raw_tweet capture).
 */
export async function fetchTweetById(tweetId: string): Promise<Post> {
  const params = new URLSearchParams(POST_API_FIELD_PARAMS);

  // OAuth1 requires %20 for spaces; URLSearchParams uses +
  const fullUrl = `https://api.x.com/2/tweets/${tweetId}?${params.toString().replace(/\+/g, "%20")}`;

  const response = await axios.get(fullUrl, {
    headers: {
      ...getOAuth1Headers(fullUrl, "GET"),
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });

  // /2/tweets/{id} returns data.data as a single object; parsePostsResponse
  // expects an array (from the multi-tweet endpoint). Wrap to match.
  const posts = parsePostsResponse({
    ...response.data,
    data: response.data?.data ? [response.data.data] : undefined,
  });

  if (posts.length === 0) {
    throw new Error(`Tweet ${tweetId} not found or inaccessible`);
  }

  return posts[0]!;
}
