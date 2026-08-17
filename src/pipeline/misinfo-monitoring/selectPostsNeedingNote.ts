/**
 * Selection LLM for misinfo topic monitoring. Both the pre-pass and the
 * curation of the regular feed pool call it.
 *
 * The call gets a topic's brief and the posts the keyword filter matched. The
 * brief is a distilled debunk. For a time-boxed news event such as
 * trump_election_security it is the source's transcript instead. The model
 * returns the IDs of the posts that carry a misleading claim the reference can
 * correct. It filters out posts that are merely on the topic, and posts that are
 * accurate, opinion, or satire. This is one cheap call per topic and the model
 * answers in JSON.
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
 * Throws ModelOutputInvalidError when the model cannot produce valid JSON after
 * the retries, for example because its response was truncated. The error is
 * deliberately not swallowed into an empty list. Callers record their sightings
 * before evaluating them, so a thrown error leaves those rows without a verdict
 * and they are evaluated again next run. An empty list would instead record
 * every post in the batch as not needing a note, and those posts would be lost
 * for good.
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
