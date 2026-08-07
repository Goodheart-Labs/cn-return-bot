/**
 * Prompt — misinfo pre-pass post selection.
 *
 * The model receives a topic's debunking brief and the posts that matched the
 * topic's keywords. It returns the ids of the posts that carry a misleading
 * claim the brief can correct. The output is free-form JSON, requested through
 * response_format json_object rather than a strict schema. See
 * selectPostsNeedingNote in
 * src/pipeline/misinfo-monitoring/selectPostsNeedingNote.ts.
 */

import type { Post } from "../../../api/fetchEligiblePosts";
import type { MisinfoTopic } from "../../misinfo-monitoring/topics";

export const SELECT_POSTS_SYSTEM_PROMPT = `You screen social-media posts for a Community Notes bot.

Given a ground-truth reference on a misinformation topic and a numbered list of posts, return the posts that amplify a misleading or false claim the reference can directly correct.

Exclude posts that are merely on-topic, factually accurate, pure opinion, jokes, or satire the audience is in on.

Respond with JSON: { "selected": [ { "id": "<post id>", "reason": "<one short sentence>" } ] }.`;

function numberPosts(posts: Post[]): string {
  return posts
    .map((p, i) => {
      const quoted = p.referenced_tweet_data?.text;
      return `[${i}] id=${p.id}\n${p.text ?? ""}${quoted ? `\nQUOTED: ${quoted}` : ""}`;
    })
    .join("\n\n");
}

export function buildSelectPostsUserMessage(topic: MisinfoTopic, posts: Post[]): string {
  return `## Reference: ${topic.title}\n${topic.brief}\n\n## Posts\n${numberPosts(posts)}`;
}
