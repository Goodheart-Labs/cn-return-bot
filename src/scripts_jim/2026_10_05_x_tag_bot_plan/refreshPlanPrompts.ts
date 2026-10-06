/**
 * Refreshes only the prompts, fixed replies and picks in output/planData.json,
 * and keeps its example outputs. Used while the examples wait for a re-run.
 *
 *   bun run src/scripts_jim/2026_10_05_x_tag_bot_plan/refreshPlanPrompts.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { CLASSIFIER_SYSTEM_PROMPT, NO_NOTE_REPLY_SYSTEM_PROMPT, REVISION_SYSTEM_PROMPT, STATUS_REPLIES, TAG_BOT_PICKS } from "./prompts";

const path = `${import.meta.dir}/output/planData.json`;
const planData = JSON.parse(readFileSync(path, "utf8"));
Object.assign(planData.prompts, {
  classifier: CLASSIFIER_SYSTEM_PROMPT,
  noNote: NO_NOTE_REPLY_SYSTEM_PROMPT,
  revision: REVISION_SYSTEM_PROMPT,
  statusReplies: STATUS_REPLIES,
  tagBotPicks: JSON.stringify(TAG_BOT_PICKS, null, 2),
});
writeFileSync(path, JSON.stringify(planData));
console.log("refreshed prompts in planData.json");
