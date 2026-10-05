/**
 * Runs the tag bot's proposed steps for real on two production tweets, so the
 * plan page can show genuine outputs and costs instead of invented ones.
 *
 * The posts, their media descriptions and their comments come from the latest
 * production pipeline_runs row (saved by dumpRun.ts). The replies in the thread
 * are written by hand, because no such thread exists yet. Every model output is
 * real.
 *
 *   bun run src/scripts_jim/2026_10_05_x_tag_bot_plan/runExamples.ts
 */

import "dotenv/config";
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;

import { readFileSync, writeFileSync } from "fs";
import { DEFAULT_CONFIG, withBotConfig, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { getCostTracker, withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { extractOpenRouterCost } from "../../pipeline/cost-tracking/pricing";
import { llm } from "../../pipeline/llm/llm";
import { runSearch } from "../../pipeline/simple-bot/search";
import { runTimingStage } from "../../pipeline/simple-bot/timingStage";
import { runWriter } from "../../pipeline/simple-bot/writer";
import { WEB_SEARCH_TOOL } from "../../pipeline/tool-calling/tools";
import { parseJsonWithRetry, runJsonLlmCall } from "../../pipeline/utils/jsonLlmCall";
import { extractJsonObject } from "../../pipeline/utils/jsonOutput";
import { countSubmittedNoteLength } from "../../pipeline/utils/noteLength";
import { createTweetLog, withTweetLog } from "../../pipeline/utils/tweetLog";
import {
  BOT_HANDLE,
  buildClassifierUserMessage,
  buildNoNoteReplyUserMessage,
  buildRequesterSection,
  buildRevisionUserMessage,
  CLASSIFIER_RESPONSE_FORMAT,
  CLASSIFIER_SYSTEM_PROMPT,
  NO_NOTE_REPLY_RESPONSE_FORMAT,
  NO_NOTE_REPLY_SYSTEM_PROMPT,
  renderDraftReply,
  renderNoNoteReply,
  REVISION_SCHEMA_HINT,
  REVISION_SYSTEM_PROMPT,
  type CurrentAnswer,
  type ThreadPost,
} from "./prompts";

const OPUS = "anthropic/claude-opus-5.5";
const MUSE = "meta/muse-spark-1.3-contributor";
const MAX_FETCH_USES = 3;
const MAX_FETCH_CONTENT_TOKENS = 20_000;
const WEB_FETCH_TOOL = {
  type: "web_fetch_20250910",
  name: "web_fetch",
  max_uses: MAX_FETCH_USES,
  max_content_tokens: MAX_FETCH_CONTENT_TOKENS,
};

const TAG_BOT_CONFIG: BotConfig = {
  ...DEFAULT_CONFIG,
  botId: "simple-bot",
  model: OPUS,
  web_search: "native",
  search_model: OPUS,
  writer_model: OPUS,
};

const OUTPUT_DIR = `${import.meta.dir}/output`;

function storedUserMessage(tweetId: string): string {
  const dump = JSON.parse(readFileSync(`${OUTPUT_DIR}/run_${tweetId}.json`, "utf8"));
  return dump.run.logs.note_writer_steps.search.messages["0"].userMessage;
}

function costSince(start: number): number {
  return getCostTracker().slice(start).reduce((sum, entry) => sum + (entry.cost ?? 0), 0);
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; costUsd: number; seconds: number }> {
  const start = getCostTracker().length;
  const startMs = Date.now();
  const result = await fn();
  return { result, costUsd: costSince(start), seconds: (Date.now() - startMs) / 1000 };
}

async function draftPipeline(postContext: string, postCreatedAt: string) {
  const search = await timed(() => runSearch(postContext));
  if (!search.result.correctionNeeded) return { search, writer: null, timing: null };
  const timing = await timed(() => runTimingStage({ userMessage: postContext, findings: search.result.findings, postCreatedAt }));
  const timingContext = timing.result.action === "inform" ? timing.result.contextBlock : undefined;
  const writer = await timed(() => runWriter(postContext, search.result.findings, { timingContext }));
  return { search, writer, timing };
}

function classify(botPost: string, reply: ThreadPost) {
  return timed(() => runJsonLlmCall<{ kind: string; reason: string }>({
    costName: "tag_bot.classifier",
    model: MUSE,
    messages: [
      { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
      { role: "user", content: buildClassifierUserMessage({ botPost, reply }) },
    ],
    responseFormat: CLASSIFIER_RESPONSE_FORMAT,
    schemaHint: '{"kind":"approve|feedback|other","reason":string}',
  }));
}

function noNoteReply(postContext: string, findings: string) {
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

async function revise(params: { postContext: string; findings: string; thread: ThreadPost[]; current: CurrentAnswer }) {
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
        const response = await llm.create({ model: OPUS, messages, tools: [WEB_SEARCH_TOOL, WEB_FETCH_TOOL] } as any);
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

/** Worked example 1: a post with a false claim. Draft, an off-topic reply, a
 *  feedback reply that leads to a revision, and an approval. */
async function mumbaiExample() {
  const tweetId = "2105056819546554803";
  const requester = { handle: "priya_k_writes", text: `@${BOT_HANDLE} is this true? I was in Mumbai last year and Dharavi definitely still exists` };
  const postContext = `${storedUserMessage(tweetId)}\n\n${buildRequesterSection({ handle: requester.handle, text: requester.text.replace(`@${BOT_HANDLE} `, "") })}`;
  const pipeline = await draftPipeline(postContext, "2026-09-29T22:07:10.000Z");
  const findings = pipeline.search.result.findings;
  if (!pipeline.writer || !pipeline.writer.result.noteText) return { tweetId, requester, postContext, pipeline };

  const draft = { text: pipeline.writer.result.noteText, sources: pipeline.writer.result.sources };
  const draftReply = renderDraftReply(draft);
  const replies: ThreadPost[] = [
    { handle: "redpill_raj", text: `@${BOT_HANDLE} @priya_k_writes lol imagine needing a bot to tell you India has slums` },
    { handle: "mvaidya", text: `@${BOT_HANDLE} newkerala is a pretty weak source, and "described as" is vague. The post says the slums are "largely gone", so say how many people in Mumbai still live in slums overall, from something official.` },
    { handle: "priya_k_writes", text: `@${BOT_HANDLE} approve but drop the newkerala link, use something better` },
  ];
  const classifications = [];
  for (const reply of replies) classifications.push({ reply, ...(await classify(draftReply, reply)) });

  const thread: ThreadPost[] = [requester, { handle: BOT_HANDLE, text: draftReply }, replies[1]!];
  const revision = await revise({ postContext, findings, thread, current: { kind: "draft", ...draft } });
  const revisedReply = revision.revision.note
    ? renderDraftReply({ lead: revision.revision.reply, ...revision.revision.note })
    : revision.revision.reply;

  const approval: ThreadPost = { handle: "priya_k_writes", text: `@${BOT_HANDLE} @mvaidya looks good now, approve` };
  const approvalClassification = await classify(revisedReply, approval);

  return {
    tweetId, requester, postContext, pipeline, draft, draftReply, classifications,
    revision, revisedReply, approval, approvalClassification,
  };
}

/** Worked example 2: a post whose claims hold up. A "no note needed" answer and
 *  a feedback reply the bot should not give in to. */
async function gdpExample() {
  const tweetId = "2107130020074238072";
  const requester = { handle: "dan_okafor", text: `@${BOT_HANDLE} 26% of world GDP with 4% of the people? that sounds made up` };
  const postContext = `${storedUserMessage(tweetId)}\n\n${buildRequesterSection({ handle: requester.handle, text: requester.text.replace(`@${BOT_HANDLE} `, "") })}`;
  const pipeline = await draftPipeline(postContext, "2026-10-05T15:25:20.000Z");
  const findings = pipeline.search.result.findings;
  if (pipeline.writer?.result.noteText) return { tweetId, requester, postContext, pipeline };

  const reason = await noNoteReply(postContext, findings);
  const noNoteText = renderNoNoteReply(reason.result.reply);
  const feedback: ThreadPost = {
    handle: "econ_skeptic",
    text: `@${BOT_HANDLE} Nominal GDP at market exchange rates flatters the US. At purchasing power parity the US is about 15% of world GDP and China is bigger. The note should say that.`,
  };
  const classification = await classify(noNoteText, feedback);
  const thread: ThreadPost[] = [requester, { handle: BOT_HANDLE, text: noNoteText }, feedback];
  const revision = await revise({ postContext, findings, thread, current: { kind: "no_note", reply: reason.result.reply } });
  return { tweetId, requester, postContext, pipeline, reason, noNoteText, feedback, classification, revision };
}

const which = process.argv[2] ?? "both";
const results = await withBotConfig(TAG_BOT_CONFIG, () => withCostTracker(() => withTweetLog(createTweetLog(), async () => ({
  mumbai: which === "gdp" ? null : await mumbaiExample(),
  gdp: which === "mumbai" ? null : await gdpExample(),
  costs: getCostTracker(),
}))));

writeFileSync(`${OUTPUT_DIR}/examples_${which}.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2).slice(0, 4000));
