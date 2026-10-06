/**
 * The tag bot's proposed steps as plain functions, so each example script can
 * run them on real posts. They record the cost and time of every call.
 */

import { DEFAULT_CONFIG, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { getCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { extractOpenRouterCost } from "../../pipeline/cost-tracking/pricing";
import { llm } from "../../pipeline/llm/llm";
import { WEB_SEARCH_TOOL } from "../../pipeline/tool-calling/tools";
import { parseJsonWithRetry, runJsonLlmCall } from "../../pipeline/utils/jsonLlmCall";
import { extractJsonObject } from "../../pipeline/utils/jsonOutput";
import { countSubmittedNoteLength } from "../../pipeline/utils/noteLength";
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
  type ThreadPost,
} from "./prompts";

export const OPUS = "anthropic/claude-opus-5.5";
const REASONING_EFFORT = "medium";
const MUSE = "meta/muse-spark-1.3-contributor";
const MAX_FETCH_USES = 3;
const MAX_FETCH_CONTENT_TOKENS = 20_000;
const WEB_FETCH_TOOL = {
  type: "web_fetch_20250910",
  name: "web_fetch",
  max_uses: MAX_FETCH_USES,
  max_content_tokens: MAX_FETCH_CONTENT_TOKENS,
};

export const TAG_BOT_CONFIG: BotConfig = {
  ...DEFAULT_CONFIG,
  botId: "simple-bot",
  model: OPUS,
  web_search: "native",
  search_model: OPUS,
  search_reasoning_effort: REASONING_EFFORT,
  writer_model: OPUS,
  writer_reasoning_effort: REASONING_EFFORT,
};

/** The cap the plan proposes after the first revision run cost $1.36: two pages
 *  per call, at most 8,000 tokens each. */
export const CAPPED_WEB_FETCH_TOOL = { ...WEB_FETCH_TOOL, max_uses: 2, max_content_tokens: 8_000 };

function costSince(start: number): number {
  return getCostTracker().slice(start).reduce((sum, entry) => sum + (entry.cost ?? 0), 0);
}

export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; costUsd: number; seconds: number }> {
  const start = getCostTracker().length;
  const startMs = Date.now();
  const result = await fn();
  return { result, costUsd: costSince(start), seconds: (Date.now() - startMs) / 1000 };
}

export function classify(botPost: string, reply: ThreadPost) {
  return timed(() => runJsonLlmCall<{ kind: string; reason: string }>({
    costName: "tag_bot.classifier",
    model: MUSE,
    messages: [
      { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
      { role: "user", content: buildClassifierUserMessage({ botPost, reply }) },
    ],
    responseFormat: CLASSIFIER_RESPONSE_FORMAT,
    schemaHint: '{"kind":"approve|improve_and_approve|feedback|other","reason":string}',
  }));
}

export function noNoteReply(postContext: string, findings: string) {
  return timed(() => runJsonLlmCall<{ reply: string }>({
    costName: "tag_bot.no_note_reply",
    model: MUSE,
    messages: [
      { role: "system", content: NO_NOTE_REPLY_SYSTEM_PROMPT },
      { role: "user", content: buildNoNoteReplyUserMessage({ postContext, findings }) },
    ],
    responseFormat: NO_NOTE_REPLY_RESPONSE_FORMAT,
    schemaHint: '{"reply":string}',
  }));
}

interface Revision {
  action: "revise" | "keep" | "withdraw";
  reply: string;
  note: { text: string; sources: string[] } | null;
}

export async function revise(
  params: { postContext: string; findings: string; thread: ThreadPost[]; current: CurrentAnswer },
  fetchTool: object = WEB_FETCH_TOOL,
) {
  const userMessage = buildRevisionUserMessage(params);
  let toolUse: unknown = null;
  const run = await timed(async () => {
    let costUsd = 0;
    const revision = await parseJsonWithRetry<Revision>({
      source: "tag_bot.revision",
      messages: [
        { role: "system", content: REVISION_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      schemaHint: REVISION_SCHEMA_HINT,
      call: async (messages) => {
        const response = await llm.create({ model: OPUS, reasoning_effort: REASONING_EFFORT, messages, tools: [WEB_SEARCH_TOOL, fetchTool] } as any);
        costUsd += extractOpenRouterCost(response).cost;
        const message = response.choices?.[0]?.message as any;
        toolUse = { usage: (response as any).usage, annotations: message?.annotations?.map((a: any) => a?.url_citation?.url) };
        const raw = message?.content ?? "";
        return { toParse: extractJsonObject(raw), assistantEcho: raw };
      },
      parse: (toParse) => {
        const output = JSON.parse(toParse) as Revision;
        if (!["revise", "keep", "withdraw"].includes(output.action) || typeof output.reply !== "string") {
          throw new Error("bad revision shape");
        }
        return output;
      },
    });
    return { revision, costUsd };
  });
  const note = run.result.revision.note;
  return {
    userMessage,
    revision: run.result.revision,
    noteLength: note ? countSubmittedNoteLength(note.text, note.sources) : null,
    costUsd: run.result.costUsd,
    seconds: run.seconds,
    toolUse,
  };
}

