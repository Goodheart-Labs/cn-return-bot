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
import { TAG_BOT_PICKS } from "../../x-tag-bot/bot";
import { buildNoNoteReplyUserMessage, NO_NOTE_REPLY_SYSTEM_PROMPT } from "../../x-tag-bot/noNoteReply";
import * as replies from "../../x-tag-bot/replies";
import { formatNoteRequest } from "../../pipeline/prompts/input/userMessage";
import { SIGNAL_PICKS } from "../../signal-bot/drafting";

const OUTPUT_DIR = `${import.meta.dir}/output`;
const PLACEHOLDER_DRAFT = { text: "<note text>", sources: ["<source 1>", "<source 2>"] };
const NOTE_ID = "<note id>";
const read = (name: string) => JSON.parse(readFileSync(`${OUTPUT_DIR}/${name}`, "utf8"));

const mumbai = read("examples_mumbai.json").mumbai;
const mumbaiFirstTry = read("examples_mumbai_v1_main_claim_only.json").mumbai;
const gdp = read("examples_gdp.json").gdp;
const costs = [...read("examples_mumbai.json").costs, ...read("examples_gdp.json").costs];

const planData = {
  prompts: {
    search: `${SEARCH_SYSTEM_PROMPT}\n\n${SEARCH_PROMPTED_JSON_INSTRUCTION}`,
    writer: WRITER_SYSTEM_PROMPT,
    timing: TIMING_EXTRACTOR_SYSTEM_PROMPT,
    requesterSection: formatNoteRequest({ handle: "<handle>", text: "<comment without the @ tag>" }),
    noNote: NO_NOTE_REPLY_SYSTEM_PROMPT,
    submittedTemplate: replies.submittedNoteReply(PLACEHOLDER_DRAFT, NOTE_ID),
    waitingEligibilityTemplate: replies.waitingNoteReply(PLACEHOLDER_DRAFT, "eligibility"),
    waitingLimitTemplate: replies.waitingNoteReply(PLACEHOLDER_DRAFT, "limit"),
    statusReplies: {
      submittedLater: replies.submittedLaterReply(NOTE_ID),
      alreadySubmitted: replies.alreadySubmittedReply(NOTE_ID),
      earlierAnswer: replies.earlierAnswerReply("<id of the first answer>"),
      gaveUp: replies.gaveUpReply("limit"),
      gaveUpNotEligible: replies.gaveUpReply("eligibility"),
      postDeleted: replies.POST_DELETED_REPLY,
      unreadable: replies.UNREADABLE_REPLY,
    },
    tagBotPicks: JSON.stringify(TAG_BOT_PICKS, null, 2),
    signalPicks: JSON.stringify(SIGNAL_PICKS, null, 2),
  },
  mumbaiWaitingNote: replies.waitingNoteReply(mumbai.draft, "eligibility"),
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
  },
  gdp: {
    tweetId: gdp.tweetId,
    requester: gdp.requester,
    postContext: gdp.postContext,
    search: gdp.pipeline.search,
    noNoteUserMessage: buildNoNoteReplyUserMessage({ postContext: gdp.postContext, findings: gdp.pipeline.search.result.findings }),
    reason: gdp.reason,
    feedback: gdp.feedback,
  },
  costs,
};

writeFileSync(`${OUTPUT_DIR}/planData.json`, JSON.stringify(planData));
console.log(`wrote planData.json, ${JSON.stringify(planData).length} chars`);
for (const entry of costs) console.log(entry.name, entry.input_tokens, entry.output_tokens, entry.cost);
