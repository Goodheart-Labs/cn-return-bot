import axios from "axios";
import { getOAuth1Headers } from "./getOAuthToken";
import { parsePostsResponse, singleTweetFieldParams, type Post } from "./fetchEligiblePosts";

export class TweetLookupError extends Error {
  constructor(
    readonly kind: "http" | "timeout" | "network" | "unavailable" | "invalid_response",
    message: string,
    readonly status?: number,
    readonly reason?: "client-not-enrolled",
  ) {
    super(message);
    this.name = "TweetLookupError";
  }
}

/**
 * Fetch a single tweet by its ID from the X API v2.
 * It asks for the same fields and expansions as fetchEligiblePosts, so the Post
 * it returns has an identical shape. That includes the full raw tweet capture.
 */
export async function fetchTweetById(tweetId: string): Promise<Post> {
  const params = new URLSearchParams(singleTweetFieldParams());

  // OAuth1 requires spaces to be encoded as %20, but URLSearchParams encodes
  // them as +, so we swap them back.
  const fullUrl = `https://api.x.com/2/tweets/${tweetId}?${params.toString().replace(/\+/g, "%20")}`;

  let response;
  try {
    response = await axios.get(fullUrl, {
      headers: {
        ...getOAuth1Headers(fullUrl, "GET"),
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  } catch (err) {
    // Axios reports a failed request as an opaque "Request failed with status
    // code 400". X puts the actual reason in the response body, so we surface
    // that body in the error message.
    if (axios.isAxiosError(err)) {
      if (err.response) {
        throw new TweetLookupError(
          "http",
          `X API ${err.response.status} fetching tweet ${tweetId}: ${JSON.stringify(err.response.data)}`,
          err.response.status,
          err.response.data?.reason === "client-not-enrolled" ? "client-not-enrolled" : undefined,
        );
      }
      const kind = err.code === "ECONNABORTED" || err.code === "ETIMEDOUT"
        ? "timeout"
        : err.code === "ERR_BAD_RESPONSE" ? "invalid_response" : "network";
      throw new TweetLookupError(kind, `X API ${kind} fetching tweet ${tweetId}: ${err.message}`);
    }
    throw err;
  }

  const invalidResponse = () => new TweetLookupError(
    "invalid_response", `X API returned an invalid response fetching tweet ${tweetId}`,
  );
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    throw invalidResponse();
  }
  if (response.data.data == null) {
    throw new TweetLookupError("unavailable", `Tweet ${tweetId} not found or inaccessible`);
  }

  // The /2/tweets/{id} endpoint puts a single object in data.data.
  // parsePostsResponse expects the array that the multi-tweet endpoint returns,
  // so we wrap the object in an array.
  let posts: Post[];
  try {
    const tweet = response.data.data;
    if (typeof tweet !== "object" || Array.isArray(tweet) || tweet.id !== tweetId ||
      typeof (tweet.note_tweet?.text ?? tweet.text) !== "string") {
      throw invalidResponse();
    }
    posts = parsePostsResponse({ ...response.data, data: [tweet] });
  } catch {
    throw invalidResponse();
  }

  if (posts.length === 0) {
    throw new TweetLookupError("unavailable", `Tweet ${tweetId} not found or inaccessible`);
  }

  return posts[0]!;
}
