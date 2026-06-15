/**
 * Keyword pre-filter for the misinfo pre-pass.
 *
 * Free (regex-only) first cut: reduce the ~thousands of crawled posts down to
 * the per-topic candidates the selection LLM then judges. Matches the
 * investigation's blob(): lowercased post text + the quoted/retweeted text.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import { MISINFO_TOPICS } from "./topics";

export function blob(post: Post): string {
  const quoted = post.referenced_tweet_data?.text ?? "";
  return `${post.text ?? ""}\n${quoted}`.toLowerCase();
}

/** Map of topicId → posts whose blob matched that topic's keyword predicate. */
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
