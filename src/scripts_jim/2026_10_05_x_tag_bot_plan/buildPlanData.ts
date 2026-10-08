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
import { buildClassifierUserMessage, buildNoNoteReplyUserMessage } from "./prompts";
import { TAG_BOT_PICKS } from "../../x-tag-bot/bot";
import { CLASSIFIER_SYSTEM_PROMPT, NO_NOTE_REPLY_SYSTEM_PROMPT, REVISION_SYSTEM_PROMPT } from "../../x-tag-bot/prompts";
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
    classifier: CLASSIFIER_SYSTEM_PROMPT,
    revision: REVISION_SYSTEM_PROMPT,
    submittedTemplate: replies.submittedNoteReply({ draft: PLACEHOLDER_DRAFT, noteId: NOTE_ID, lead: "<the revision call's reply, only on a revised note>" }),
    waitingEligibilityTemplate: replies.waitingNoteReply({ draft: PLACEHOLDER_DRAFT, reason: "eligibility", lead: "<the revision call's reply, only on a revised note>" }),
    waitingLimitTemplate: replies.waitingNoteReply({ draft: PLACEHOLDER_DRAFT, reason: "limit" }),
    noNoteTemplate: replies.noNoteReply("<the no-note reply>"),
    statusReplies: {
      submittedLater: replies.submittedLaterReply(NOTE_ID),
      otherVersionSubmitted: replies.otherVersionSubmittedReply({ versionPostId: "<id of the submitted version's post>", noteId: NOTE_ID }),
      alreadySubmitted: replies.alreadySubmittedReply(NOTE_ID),
      gaveUp: replies.gaveUpReply("limit"),
      gaveUpNotEligible: replies.gaveUpReply("eligibility"),
      postDeleted: replies.POST_DELETED_REPLY,
      unreadable: replies.UNREADABLE_REPLY,
    },
    tagBotPicks: JSON.stringify(TAG_BOT_PICKS, null, 2),
    signalPicks: JSON.stringify(SIGNAL_PICKS, null, 2),
  },
  classifierRuns: read("examples_classifier_no_approval.json"),
  mumbaiWaitingNote: replies.waitingNoteReply({ draft: mumbai.draft, reason: "eligibility" }),
  mumbaiRevisedNote: replies.waitingNoteReply({ draft: mumbai.revision.revision.note, reason: "eligibility", lead: mumbai.revision.revision.reply }),
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
    revision: mumbai.revision,
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
    revision: gdp.revision,
  },
  costs,
};

writeFileSync(`${OUTPUT_DIR}/planData.json`, JSON.stringify(planData));
console.log(`wrote planData.json, ${JSON.stringify(planData).length} chars`);
for (const entry of costs) console.log(entry.name, entry.input_tokens, entry.output_tokens, entry.cost);
