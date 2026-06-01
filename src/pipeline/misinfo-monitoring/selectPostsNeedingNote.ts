/**
 * Selection LLM for the misinfo pre-pass.
 *
 * Given a topic's distilled debunking brief and the keyword-matched posts, the
 * LLM returns the IDs of posts that contain a misleading claim the brief can
 * correct — filtering out posts that are merely on-topic, accurate, opinion, or
 * satire. One cheap call per topic, JSON output.
 */

import { llm } from "../llm/llm";
import type { Post } from "../../api/fetchEligiblePosts";
import type { MisinfoTopic } from "./topics";

const SELECTION_MODEL = "google/gemini-3-flash-preview";

export interface SelectedPost {
  postId: string;
  reason: string;
}

const SYSTEM_PROMPT = `You screen social-media posts for a Community Notes bot.

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

export async function selectPostsNeedingNote(
  topic: MisinfoTopic,
  posts: Post[],
): Promise<SelectedPost[]> {
  if (!posts.length) return [];

  const userMessage = `## Ground-truth brief: ${topic.title}\n${topic.brief}\n\n## Posts\n${numberPosts(posts)}`;

  const response = await llm.create({
    model: SELECTION_MODEL,
    messages: [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: userMessage },
    ],
    response_format: { type: "json_object" },
  } as any);

  const content = response.choices?.[0]?.message?.content ?? "{}";
  let parsed: { selected?: Array<{ id?: string; reason?: string }> };
  try {
    parsed = JSON.parse(content);
  } catch {
    console.warn(`[misinfo] selection LLM returned non-JSON for ${topic.id}: ${content.slice(0, 200)}`);
    return [];
  }

  const validIds = new Set(posts.map((p) => p.id));
  return (parsed.selected ?? [])
    .filter((s): s is { id: string; reason?: string } => typeof s.id === "string" && validIds.has(s.id))
    .map((s) => ({ postId: s.id, reason: s.reason ?? "" }));
}
