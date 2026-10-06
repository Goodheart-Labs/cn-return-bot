/**
 * The bot's own model calls. Muse sorts replies and writes the no-note reply.
 * Opus 5.5 at medium reasoning revises a draft, with web search and web fetch
 * run by the provider inside the one call.
 */

import { DEFAULT_CONFIG, withBotConfig } from "../pipeline/ab-testing/botConfig";
import { extractOpenRouterCost } from "../pipeline/cost-tracking/pricing";
import { trackLlmCall, withCostTracker } from "../pipeline/cost-tracking/costTracker";
import { llm } from "../pipeline/llm/llm";
import { WEB_SEARCH_TOOL } from "../pipeline/tool-calling/tools";
import { parseJsonWithRetry, runJsonLlmCall } from "../pipeline/utils/jsonLlmCall";
import { extractJsonObject } from "../pipeline/utils/jsonOutput";
import { countSubmittedNoteLength } from "../pipeline/utils/noteLength";
import {
  buildClassifierUserMessage,
  buildNoNoteReplyUserMessage,
  buildRevisionUserMessage,
  CLASSIFIER_RESPONSE_FORMAT,
  CLASSIFIER_SYSTEM_PROMPT,
  NO_NOTE_REPLY_RESPONSE_FORMAT,
  NO_NOTE_REPLY_SYSTEM_PROMPT,
  REVISION_SCHEMA_HINT,
  REVISION_SYSTEM_PROMPT,
  type CurrentAnswer,
  type ReplyKind,
  type ThreadPost,
} from "./prompts";
import type { NoteDraft } from "./replies";

const MUSE = "meta/muse-spark-1.3-contributor";
const OPUS = "anthropic/claude-opus-5.5";
const REVISION_REASONING_EFFORT = "medium";
const MAX_NOTE_CHARS = 280;
const MAX_SOURCES = 5;
/** Opus reads every fetched page as input. An uncapped revision cost $1.10 in
 *  the plan's test, a capped one $0.31. */
const WEB_FETCH_TOOL = { type: "web_fetch_20250910", name: "web_fetch", max_uses: 2, max_content_tokens: 8_000 };

export type Revision =
  | { action: "revise"; reply: string; note: NoteDraft }
  | { action: "keep" | "withdraw"; reply: string };

export interface RevisionInput {
  postContext: string;
  findings: string;
  thread: ThreadPost[];
  current: CurrentAnswer;
  improveAndApprove?: boolean;
}

export interface TagBotModels {
  classify(botPost: string, reply: ThreadPost): Promise<ReplyKind>;
  writeNoNoteReply(postContext: string, findings: string): Promise<string>;
  revise(input: RevisionInput): Promise<Revision>;
}

/** runJsonLlmCall reads the bot config and records costs, so every call runs
 *  inside both. */
function inBotScope<T>(fn: () => Promise<T>): Promise<T> {
  return withBotConfig({ ...DEFAULT_CONFIG, botId: "x-tag" }, () => withCostTracker(fn));
}

export const tagBotModels: TagBotModels = {
  async classify(botPost, reply) {
    const { kind } = await inBotScope(() => runJsonLlmCall<{ kind: ReplyKind; reason: string }>({
      costName: "x_tag.classifier",
      model: MUSE,
      messages: [
        { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
        { role: "user", content: buildClassifierUserMessage({ botPost, reply }) },
      ],
      responseFormat: CLASSIFIER_RESPONSE_FORMAT,
      schemaHint: '{"kind":"approve|improve_and_approve|feedback|other","reason":string}',
    }));
    return kind;
  },

  async writeNoNoteReply(postContext, findings) {
    const { reply } = await inBotScope(() => runJsonLlmCall<{ reply: string }>({
      costName: "x_tag.no_note_reply",
      model: MUSE,
      messages: [
        { role: "system", content: NO_NOTE_REPLY_SYSTEM_PROMPT },
        { role: "user", content: buildNoNoteReplyUserMessage({ postContext, findings }) },
      ],
      responseFormat: NO_NOTE_REPLY_RESPONSE_FORMAT,
      schemaHint: '{"reply":string}',
    }));
    return reply;
  },

  revise(input) {
    // Opus garbles its output when a server-side tool and a strict
    // response_format come together (see searchDispatch.ts), so the JSON is
    // asked for in the prompt and dug out of the reply.
    return inBotScope(() => parseJsonWithRetry<Revision>({
      source: "x_tag.revision",
      messages: [
        { role: "system", content: REVISION_SYSTEM_PROMPT },
        { role: "user", content: buildRevisionUserMessage(input) },
      ],
      schemaHint: REVISION_SCHEMA_HINT,
      call: async (messages) => {
        const response = await llm.create({
          model: OPUS, reasoning_effort: REVISION_REASONING_EFFORT, messages, tools: [WEB_SEARCH_TOOL, WEB_FETCH_TOOL],
        } as any);
        trackLlmCall({ name: "x_tag.revision", ...extractOpenRouterCost(response), tools: [] });
        const raw = response.choices?.[0]?.message?.content ?? "";
        return { toParse: extractJsonObject(raw), assistantEcho: raw };
      },
      parse: (toParse) => parseRevision(JSON.parse(toParse)),
    }));
  },
};

/** Checks the model's answer before anything is posted. A revised note must
 *  fit X's 280 characters, with every link counted as one, and cite one to
 *  five public links. A bad answer counts as a parse failure, so the model is
 *  asked again. */
export function parseRevision(output: any): Revision {
  if (typeof output?.reply !== "string" || !output.reply.trim()) throw new Error("The revision has no reply.");
  if (output.action === "keep" || output.action === "withdraw") return { action: output.action, reply: output.reply };
  if (output.action !== "revise") throw new Error("Unknown revision action.");
  const note = output.note;
  const sources: unknown[] = Array.isArray(note?.sources) ? note.sources : [];
  if (typeof note?.text !== "string" || !note.text.trim()) throw new Error("The revised note is empty.");
  if (sources.length === 0 || sources.length > MAX_SOURCES || !sources.every((url) => typeof url === "string" && /^https?:\/\/\S+$/.test(url))) {
    throw new Error("The revised note needs one to five links.");
  }
  if (countSubmittedNoteLength(note.text, sources as string[]) > MAX_NOTE_CHARS) throw new Error("The revised note is too long.");
  return { action: "revise", reply: output.reply, note: { text: note.text, sources: sources as string[] } };
}
