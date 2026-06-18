/**
 * Prompt — misinfo pre-pass post selection.
 *
 * Given a topic's debunking brief + keyword-matched posts, returns the IDs of
 * posts with a misleading claim the brief can correct. Free-form JSON output
 * (json_object). See selectPostsNeedingNote in
 * src/pipeline/misinfo-monitoring/selectPostsNeedingNote.ts.
 */

import type { Post } from "../../../api/fetchEligiblePosts";
import type { MisinfoTopic } from "../../misinfo-monitoring/topics";

export const SELECT_POSTS_SYSTEM_PROMPT = `You screen social-media posts for a Community Notes bot.

Given a ground-truth brief on a misinformation topic and a numbered list of posts, return the posts that contain a misleading or false claim the brief can directly correct.

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
  return `## Ground-truth brief: ${topic.title}\n${topic.brief}\n\n## Posts\n${numberPosts(posts)}`;
}
