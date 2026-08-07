/**
 * The simple bot's correction extractor.
 *
 * It makes one LLM call that breaks the search findings into separate atomic
 * corrections and grades each one by importance. The orchestrator keeps only
 * the high-value grades and passes those to the writer. The stage runs only
 * when `config.correction_extraction` is on, which is the
 * SIMPLE_BOT_CORRECTION_EXTRACTION_TEST arm.
 */

import { getBotConfig } from "../ab-testing/botConfig";
import { getTweetLog } from "../utils/tweetLog";
import { STEP, COST } from "../utils/noteWriterSteps";
import { runJsonLlmCall } from "../utils/jsonLlmCall";
import {
  CORRECTION_EXTRACTOR_SYSTEM_PROMPT,
  CORRECTION_EXTRACTOR_RESPONSE_FORMAT,
  type CorrectionCategory,
} from "../prompts/simple-bot/correctionExtractor";

export interface AtomicCorrection {
  name: string;
  category: CorrectionCategory;
  explanation: string;
}

/** This stage sees only the search findings. Withholding the post context is
 *  deliberate. */
export async function runCorrectionExtractor(findings: string): Promise<AtomicCorrection[]> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = config.correction_extraction_model ?? config.model;

  const messages = [
    { role: "system" as const, content: CORRECTION_EXTRACTOR_SYSTEM_PROMPT },
    { role: "user" as const, content: findings },
  ];
  log?.set(`${STEP.correctionExtractor}.messages.0`, { model, messages });

  const parsed = await runJsonLlmCall<{ corrections: AtomicCorrection[] }>({
    costName: COST.correctionExtractor,
    model,
    messages,
    responseFormat: CORRECTION_EXTRACTOR_RESPONSE_FORMAT,
    schemaHint: `{ "corrections": [ { "name": string, "category": string, "explanation": string } ] }`,
  });
  const corrections = parsed.corrections ?? [];
  log?.set(`${STEP.correctionExtractor}.messages.1`, { corrections });

  return corrections;
}
