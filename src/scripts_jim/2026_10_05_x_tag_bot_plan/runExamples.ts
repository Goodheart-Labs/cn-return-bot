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
import { withBotConfig } from "../../pipeline/ab-testing/botConfig";
import { getCostTracker, withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { runSearch } from "../../pipeline/simple-bot/search";
import { runTimingStage } from "../../pipeline/simple-bot/timingStage";
import { runWriter } from "../../pipeline/simple-bot/writer";
import { createTweetLog, withTweetLog } from "../../pipeline/utils/tweetLog";
import { BOT_HANDLE, buildRequesterSection, renderDraftReply, renderNoNoteReply, type ThreadPost } from "./prompts";
import { classify, noNoteReply, revise, TAG_BOT_CONFIG, timed } from "./steps";

const OUTPUT_DIR = `${import.meta.dir}/output`;

function storedUserMessage(tweetId: string): string {
  const dump = JSON.parse(readFileSync(`${OUTPUT_DIR}/run_${tweetId}.json`, "utf8"));
  return dump.run.logs.note_writer_steps.search.messages["0"].userMessage;
}

async function draftPipeline(postContext: string, postCreatedAt: string) {
  const search = await timed(() => runSearch(postContext));
  if (!search.result.correctionNeeded) return { search, writer: null, timing: null };
  const timing = await timed(() => runTimingStage({ userMessage: postContext, findings: search.result.findings, postCreatedAt }));
  const timingContext = timing.result.action === "inform" ? timing.result.contextBlock : undefined;
  const writer = await timed(() => runWriter(postContext, search.result.findings, { timingContext }));
  return { search, writer, timing };
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
