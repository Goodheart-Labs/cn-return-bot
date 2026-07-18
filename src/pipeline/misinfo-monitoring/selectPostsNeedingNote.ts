/**
 * Selection LLM for the misinfo pre-pass.
 *
 * Given a topic's reference (its debunking brief, or a transcript for a
 * time-boxed event) and the keyword-matched posts, the LLM returns the IDs of
 * posts that contain a misleading claim the reference can correct — filtering
 * out posts that are merely on-topic, accurate, opinion, or satire. One cheap
 * call per topic, JSON output.
 */

import { llm } from "../llm/llm";
import type { Post } from "../../api/fetchEligiblePosts";
import type { MisinfoTopic } from "./topics";
import { SELECT_POSTS_SYSTEM_PROMPT, buildSelectPostsUserMessage } from "../prompts/misinfo-monitoring/selectPosts";

const SELECTION_MODEL = "google/gemini-3-flash-preview";

export interface SelectedPost {
  postId: string;
  reason: string;
}

export async function selectPostsNeedingNote(
  topic: MisinfoTopic,
  posts: Post[],
): Promise<SelectedPost[]> {
  if (!posts.length) return [];

  const userMessage = buildSelectPostsUserMessage(topic, posts);

  const response = await llm.create({
    model: SELECTION_MODEL,
    messages: [
      { role: "system" as const, content: SELECT_POSTS_SYSTEM_PROMPT },
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
