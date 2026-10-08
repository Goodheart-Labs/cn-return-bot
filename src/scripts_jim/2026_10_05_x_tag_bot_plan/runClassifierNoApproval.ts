/**
 * Runs the tag bot's two-kind classifier (feedback or other), from the real
 * bot code, on the example threads' replies, after the switch to submitting
 * without approval (2026-10-08).
 *
 *   bun run src/scripts_jim/2026_10_05_x_tag_bot_plan/runClassifierNoApproval.ts
 */

import "dotenv/config";
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;

import { readFileSync, writeFileSync } from "fs";
import { getCostTracker, withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { tagBotModels } from "../../x-tag-bot/models";
import { buildClassifierUserMessage } from "../../x-tag-bot/prompts";
import { noNoteReply, waitingNoteReply } from "../../x-tag-bot/replies";

const OUTPUT_DIR = `${import.meta.dir}/output`;
const mumbai = JSON.parse(readFileSync(`${OUTPUT_DIR}/examples_mumbai.json`, "utf8")).mumbai;
const gdp = JSON.parse(readFileSync(`${OUTPUT_DIR}/examples_gdp.json`, "utf8")).gdp;
const mumbaiNote = waitingNoteReply({ draft: mumbai.draft, reason: "eligibility" });

const cases = [
  { botPost: mumbaiNote, reply: mumbai.classifications[0].reply },
  { botPost: mumbaiNote, reply: mumbai.classifications[1].reply },
  { botPost: mumbaiNote, reply: { handle: "priya_k_writes", text: "@CommonNotesBot thanks, great note!" } },
  { botPost: noNoteReply(gdp.reason.result.reply), reply: gdp.feedback },
];

const results = [];
for (const { botPost, reply } of cases) {
  const startMs = Date.now();
  const { kind, costUsd } = await withCostTracker(async () => {
    const kind = await tagBotModels.classify(botPost, reply);
    return { kind, costUsd: getCostTracker().reduce((sum, entry) => sum + entry.cost, 0) };
  });
  results.push({ reply, kind, userMessage: buildClassifierUserMessage({ botPost, reply }), costUsd, seconds: (Date.now() - startMs) / 1000 });
  console.log(kind, "|", reply.text);
}
writeFileSync(`${OUTPUT_DIR}/examples_classifier_no_approval.json`, JSON.stringify(results, null, 2));
