/**
 * Collects every prompt word for word from the code, plus the real outputs of
 * runExamples.ts, into one JSON file that the plan page embeds. Run it after
 * runExamples.ts.
 *
 *   bun run src/scripts_jim/2026_10_05_x_tag_bot_plan/buildPlanData.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { SEARCH_PROMPTED_JSON_INSTRUCTION, SEARCH_SYSTEM_PROMPT } from "../../pipeline/prompts/simple-bot/searchAgent";
import { TIMING_EXTRACTOR_SYSTEM_PROMPT } from "../../pipeline/prompts/simple-bot/timingJudge";
import { buildWriterUserMessage, WRITER_SYSTEM_PROMPT } from "../../pipeline/prompts/simple-bot/writer";
import {
  buildClassifierUserMessage,
  buildNoNoteReplyUserMessage,
  buildRequesterSection,
  CLASSIFIER_SYSTEM_PROMPT,
  NO_NOTE_REPLY_SYSTEM_PROMPT,
  renderDraftReply,
  renderNoNoteReply,
  IMPROVE_AND_APPROVE_NOTICE,
  REVISION_SYSTEM_PROMPT,
  STATUS_REPLIES,
  TAG_BOT_PICKS,
} from "./prompts";
import { SIGNAL_PICKS } from "../../signal-bot/drafting";

const OUTPUT_DIR = `${import.meta.dir}/output`;
const read = (name: string) => JSON.parse(readFileSync(`${OUTPUT_DIR}/${name}`, "utf8"));

const mumbai = read("examples_mumbai.json").mumbai;
const mumbaiFirstTry = read("examples_mumbai_v1_main_claim_only.json").mumbai;
const gdp = read("examples_gdp.json").gdp;
const improve = read("examples_improve.json");
const costs = [...read("examples_mumbai.json").costs, ...read("examples_gdp.json").costs];

const planData = {
  prompts: {
    search: `${SEARCH_SYSTEM_PROMPT}\n\n${SEARCH_PROMPTED_JSON_INSTRUCTION}`,
    writer: WRITER_SYSTEM_PROMPT,
    timing: TIMING_EXTRACTOR_SYSTEM_PROMPT,
    requesterSection: buildRequesterSection({ handle: "<handle>", text: "<comment without the @ tag>" }),
    noNote: NO_NOTE_REPLY_SYSTEM_PROMPT,
    classifier: CLASSIFIER_SYSTEM_PROMPT,
    revision: REVISION_SYSTEM_PROMPT,
    draftTemplate: renderDraftReply({ lead: "<the revision call's reply, only on a revised draft>", text: "<note text>", sources: ["<source 1>", "<source 2>"] }),
    noNoteTemplate: renderNoNoteReply("<the no-note reply>"),
    statusReplies: STATUS_REPLIES,
    improveNotice: IMPROVE_AND_APPROVE_NOTICE,
    tagBotPicks: JSON.stringify(TAG_BOT_PICKS, null, 2),
    signalPicks: JSON.stringify(SIGNAL_PICKS, null, 2),
  },
  improve: {
    classifications: improve.classifications.map((c: any) => ({ ...c, userMessage: buildClassifierUserMessage({ botPost: c.botPost, reply: c.reply }) })),
    request: improve.improveRequest,
    revision: improve.revision,
  },
  mumbai: {
    tweetId: mumbai.tweetId,
    requester: mumbai.requester,
    postContext: mumbai.postContext,
    search: mumbai.pipeline.search,
    searchFirstTry: mumbaiFirstTry.pipeline.search,
    timing: mumbai.pipeline.timing,
    writerUserMessage: buildWriterUserMessage(mumbai.postContext, mumbai.pipeline.search.result.findings),
    writer: mumbai.pipeline.writer,
    draft: mumbai.draft,
    draftReply: mumbai.draftReply,
    classifications: mumbai.classifications.map((c: any) => ({
      ...c,
      userMessage: buildClassifierUserMessage({ botPost: mumbai.draftReply, reply: c.reply }),
    })),
    revision: mumbai.revision,
    revisedReply: mumbai.revisedReply,
    approval: mumbai.approval,
    approvalClassification: {
      ...mumbai.approvalClassification,
      userMessage: buildClassifierUserMessage({ botPost: mumbai.revisedReply, reply: mumbai.approval }),
    },
  },
  gdp: {
    tweetId: gdp.tweetId,
    requester: gdp.requester,
    postContext: gdp.postContext,
    search: gdp.pipeline.search,
    noNoteUserMessage: buildNoNoteReplyUserMessage({ postContext: gdp.postContext, findings: gdp.pipeline.search.result.findings }),
    reason: gdp.reason,
    noNoteText: gdp.noNoteText,
    feedback: gdp.feedback,
    classification: { ...gdp.classification, userMessage: buildClassifierUserMessage({ botPost: gdp.noNoteText, reply: gdp.feedback }) },
    revision: gdp.revision,
  },
  costs,
};

writeFileSync(`${OUTPUT_DIR}/planData.json`, JSON.stringify(planData));
console.log(`wrote planData.json, ${JSON.stringify(planData).length} chars`);
for (const entry of costs) console.log(entry.name, entry.input_tokens, entry.output_tokens, entry.cost);
