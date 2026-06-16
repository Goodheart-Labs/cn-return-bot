/**
 * cheap-bot — Stage 0: Satire detector
 *
 * Pre-search gate. Reads the post + comments + author profile WITHOUT the
 * proposed note and decides whether the post is overt satire the audience is
 * in on. A positive verdict early-exits the pipeline (no_correction) before the
 * query writer, so we never spend search/writer/judge calls fact-checking a
 * joke.
 *
 * High-precision by design: it must fire ONLY when the room is clearly in on
 * the joke (comedian/parody account, audience laughter, replies treating it as
 * comedy). It must NOT fire on fabricated content built to imitate real media
 * (fake headlines, doctored quotes, deepfakes) — those deceive and still need a
 * note. Misses are acceptable; false "satire" verdicts are not.
 *
 * Reasoning precedes the verdict so the boolean is conditioned on the analysis.
 */

import { getBotConfig } from "../ab-testing/botConfig";
import { getTweetLog } from "../utils/tweetLog";
import { STEP, COST } from "../utils/noteWriterSteps";
import { runJsonLlmCall } from "../utils/jsonLlmCall";
import { SATIRE_SYSTEM_PROMPT, SATIRE_RESPONSE_FORMAT } from "../prompts/cheap-bot/satireDetector";

export interface SatireResult {
  isSatire: boolean;
  reasoning: string;
}

export async function runSatireDetector(postContext: string): Promise<SatireResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = config.satire_model ?? config.note_judge_model ?? config.model;

  const messages = [
    { role: "system" as const, content: SATIRE_SYSTEM_PROMPT },
    { role: "user" as const, content: postContext },
  ];
  log?.set(`${STEP.satireDetector}.messages.0`, { systemPrompt: SATIRE_SYSTEM_PROMPT, userMessage: postContext, model });

  const parsed = await runJsonLlmCall<{ is_satire: boolean; reasoning: string }>({
    costName: COST.satireDetector,
    model,
    messages,
    responseFormat: SATIRE_RESPONSE_FORMAT,
    schemaHint: `{ "reasoning": string, "is_satire": boolean }`,
  });
  log?.set(`${STEP.satireDetector}.messages.1`, { content: parsed });

  return { isSatire: !!parsed.is_satire, reasoning: parsed.reasoning ?? "" };
}
