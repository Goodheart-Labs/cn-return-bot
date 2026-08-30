/**
 * Note-Needed Judge
 *
 * An extra LLM step between the writer and the source verifier. It decides
 * whether the proposed note is actually warranted, given the post and the note
 * itself. It is cheap-bot's main guard against false positives, and BOT_TEST
 * keeps it always on there.
 */

import { getBotConfig } from "../ab-testing/botConfig";
import { getTweetLog } from "../utils/tweetLog";
import { STEP, COST } from "../utils/noteWriterSteps";
import { runJsonLlmCall } from "../utils/jsonLlmCall";
import { buildJudgeSystemPrompt, buildJudgeUserMessage, JUDGE_RESPONSE_FORMAT } from "../prompts/cheap-bot/noteNeededJudge";

export interface JudgeResult {
  noteNeeded: boolean;
  reasoning: string;
}

export async function runNoteNeededJudge(params: {
  postContext: string;
  noteText: string;
  sources: string[];
}): Promise<JudgeResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = config.note_judge_model ?? config.model;

  const userMessage = buildJudgeUserMessage(params);

  const systemPrompt = buildJudgeSystemPrompt(!!config.satire_detector);
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userMessage },
  ];
  log?.set(`${STEP.noteNeededJudge}.messages.0`, { systemPrompt, userMessage, model });

  const parsed = await runJsonLlmCall<{ note_needed: boolean; reasoning: string }>({
    costName: COST.noteNeededJudge,
    model,
    messages,
    responseFormat: JUDGE_RESPONSE_FORMAT,
    schemaHint: `{ "reasoning": string, "note_needed": boolean }`,
  });
  log?.set(`${STEP.noteNeededJudge}.messages.1`, { content: parsed });

  return { noteNeeded: !!parsed.note_needed, reasoning: parsed.reasoning ?? "" };
}
