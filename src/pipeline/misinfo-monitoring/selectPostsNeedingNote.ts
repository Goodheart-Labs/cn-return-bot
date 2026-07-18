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
import { parseJsonWithRetry } from "../utils/jsonLlmCall";
import { stripJsonFences } from "../utils/jsonOutput";
import { SELECT_POSTS_SYSTEM_PROMPT, buildSelectPostsUserMessage } from "../prompts/misinfo-monitoring/selectPosts";

const SELECTION_MODEL = "google/gemini-3-flash-preview";

export interface SelectedPost {
  postId: string;
  reason: string;
}

/**
 * Throws ModelOutputInvalidError if the model can't produce valid JSON after
 * retries (e.g. a truncated response). Deliberately NOT swallowed into []: in
 * the pre-pass, sightings are recorded before evaluation, so a throw leaves
 * them needs_note=null → re-evaluated next run, whereas a silent [] would
 * record every post in the batch as needs_note=false — lost forever.
 */
export async function selectPostsNeedingNote(
  topic: MisinfoTopic,
  posts: Post[],
): Promise<SelectedPost[]> {
  if (!posts.length) return [];

  const parsed = await parseJsonWithRetry<{ selected?: Array<{ id?: string; reason?: string }> }>({
    source: `misinfo.select_posts.${topic.id}`,
    messages: [
      { role: "system" as const, content: SELECT_POSTS_SYSTEM_PROMPT },
      { role: "user" as const, content: buildSelectPostsUserMessage(topic, posts) },
    ],
    schemaHint: `{ "selected": [ { "id": string, "reason": string } ] }`,
    call: async (messages) => {
      const response = await llm.create({
        model: SELECTION_MODEL,
        messages,
        response_format: { type: "json_object" },
      } as any);
      const content = response.choices?.[0]?.message?.content ?? "{}";
      return { toParse: stripJsonFences(content), assistantEcho: content };
    },
    parse: (toParse) => JSON.parse(toParse),
  });

  const validIds = new Set(posts.map((p) => p.id));
  return (parsed.selected ?? [])
    .filter((s): s is { id: string; reason?: string } => typeof s.id === "string" && validIds.has(s.id))
    .map((s) => ({ postId: s.id, reason: s.reason ?? "" }));
}
