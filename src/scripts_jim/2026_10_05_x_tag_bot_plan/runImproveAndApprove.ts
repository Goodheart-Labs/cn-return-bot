/**
 * Runs the "improve and approve" path on the Mumbai thread's first draft: the
 * classifier with its fourth kind on every example reply, then the revision
 * for "approve but drop the newkerala link", with the fetch cap the plan
 * proposes. Reads the draft that runExamples.ts wrote, so the thread stays the
 * same.
 *
 *   bun run src/scripts_jim/2026_10_05_x_tag_bot_plan/runImproveAndApprove.ts
 */

import "dotenv/config";
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;

import { readFileSync, writeFileSync } from "fs";
import { withBotConfig } from "../../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { BOT_HANDLE, type ThreadPost } from "./prompts";
import { CAPPED_WEB_FETCH_TOOL, classify, revise, TAG_BOT_CONFIG } from "./steps";

const OUTPUT_DIR = `${import.meta.dir}/output`;
const mumbai = JSON.parse(readFileSync(`${OUTPUT_DIR}/examples_mumbai.json`, "utf8")).mumbai;
const gdp = JSON.parse(readFileSync(`${OUTPUT_DIR}/examples_gdp.json`, "utf8")).gdp;

const results = await withBotConfig(TAG_BOT_CONFIG, () => withCostTracker(async () => {
  const replies: Array<{ botPost: string; reply: ThreadPost }> = [
    ...mumbai.classifications.map((c: { reply: ThreadPost }) => ({ botPost: mumbai.draftReply, reply: c.reply })),
    { botPost: mumbai.revisedReply, reply: mumbai.approval },
    { botPost: gdp.noNoteText, reply: gdp.feedback },
  ];
  const classifications = [];
  for (const { botPost, reply } of replies) classifications.push({ botPost, reply, ...(await classify(botPost, reply)) });

  const improveRequest: ThreadPost = mumbai.classifications[2].reply;
  const thread: ThreadPost[] = [mumbai.requester, { handle: BOT_HANDLE, text: mumbai.draftReply }, improveRequest];
  const revision = await revise(
    { postContext: mumbai.postContext, findings: mumbai.pipeline.search.result.findings, thread, current: { kind: "draft", ...mumbai.draft }, improveAndApprove: true },
    CAPPED_WEB_FETCH_TOOL,
  );
  return { classifications, improveRequest, revision };
}));

writeFileSync(`${OUTPUT_DIR}/examples_improve.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ kinds: results.classifications.map((c) => [c.reply.text.slice(0, 50), c.result]), revision: results.revision.revision, cost: results.revision.costUsd, tokens: (results.revision.toolUse as any)?.usage?.prompt_tokens }, null, 2));
