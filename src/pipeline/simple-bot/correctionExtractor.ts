/**
 * Simple Bot — Correction Extractor
 *
 * One LLM call that decomposes the search findings into discrete atomic
 * corrections, each graded by importance. The orchestrator filters to the
 * high-value grades and feeds only those to the writer. Runs only when
 * `config.correction_extraction` is on (SIMPLE_BOT_CORRECTION_EXTRACTION_TEST).
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

/** Input is the search findings only — no post context, by design. */
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
