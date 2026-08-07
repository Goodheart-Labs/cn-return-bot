import axios from "axios";
import { getOAuth1Headers } from "./getOAuthToken";
import { parsePostsResponse, POST_API_FIELD_PARAMS, type Post } from "./fetchEligiblePosts";

/**
 * Fetch a single tweet by its ID from the X API v2.
 * It asks for the same fields and expansions as fetchEligiblePosts, so the Post
 * it returns has an identical shape. That includes the full raw tweet capture.
 */
export async function fetchTweetById(tweetId: string): Promise<Post> {
  const params = new URLSearchParams(POST_API_FIELD_PARAMS);

  // OAuth1 requires spaces to be encoded as %20, but URLSearchParams encodes
  // them as +, so we swap them back.
  const fullUrl = `https://api.x.com/2/tweets/${tweetId}?${params.toString().replace(/\+/g, "%20")}`;

  const response = await axios.get(fullUrl, {
    headers: {
      ...getOAuth1Headers(fullUrl, "GET"),
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });

  // The /2/tweets/{id} endpoint puts a single object in data.data.
  // parsePostsResponse expects the array that the multi-tweet endpoint returns,
  // so we wrap the object in an array.
  const posts = parsePostsResponse({
    ...response.data,
    data: response.data?.data ? [response.data.data] : undefined,
  });

  if (posts.length === 0) {
    throw new Error(`Tweet ${tweetId} not found or inaccessible`);
  }

  return posts[0]!;
}
