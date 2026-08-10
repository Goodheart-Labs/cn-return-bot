/**
 * cheap-bot stage 0: satire detector
 *
 * A gate that runs before search. It reads the post, the comments, and the
 * author profile without the proposed note, and decides whether the post is
 * overt satire the audience is in on. A positive verdict exits the pipeline
 * early with no_correction, before the query writer runs. That way we never
 * spend search, writer, or judge calls fact-checking a joke.
 *
 * The detector is high-precision by design. It must fire only when the room is
 * clearly in on the joke. Examples are a comedian or parody account, audience
 * laughter, and replies that treat the post as comedy. It must not fire on
 * fabricated content built to imitate real media, such as fake headlines,
 * doctored quotes, or deepfakes. Those deceive people and still need a note.
 * Misses are acceptable. False "satire" verdicts are not.
 *
 * The response asks for the reasoning before the verdict, so the boolean is
 * conditioned on the analysis.
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
