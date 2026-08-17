/**
 * Keyword pre-filter for the misinfo pre-pass.
 *
 * This is the first cut, and it costs nothing because it is only regular
 * expressions. It narrows the thousands of crawled posts down to the per-topic
 * candidates that the selection LLM then judges. A post is matched on the same text
 * the investigation's blob() used. That text is the post's own text plus the text of
 * any quoted or retweeted post, all lowercased.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import { MISINFO_TOPICS } from "./topics";

export function blob(post: Post): string {
  const quoted = post.referenced_tweet_data?.text ?? "";
  return `${post.text ?? ""}\n${quoted}`.toLowerCase();
}

/** Returns a map from topic id to the posts whose text matched that topic's keyword
 *  test. */
export function matchPostsByTopic(posts: Post[]): Map<string, Post[]> {
  const result = new Map<string, Post[]>(MISINFO_TOPICS.map((t) => [t.id, []]));
  for (const post of posts) {
    const b = blob(post);
    for (const topic of MISINFO_TOPICS) {
      if (topic.matches(b)) result.get(topic.id)!.push(post);
    }
  }
  return result;
}
