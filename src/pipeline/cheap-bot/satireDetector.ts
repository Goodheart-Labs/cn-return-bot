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

export interface SatireResult {
  isSatire: boolean;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a satire detector for X/Twitter posts. You receive a post, its comments, and the author's profile. Decide whether the post is overt satire/comedy that its audience is clearly in on — a joke, parody, or comedic bit that no reasonable viewer would read as a sincere factual claim.

Answer is_satire=true ONLY when the signals make the comedic intent unmistakable, e.g.:
- The author is a known comedian / parody account, or the post is a clip of a stand-up set, sketch, or comedy show (audience laughter, punchlines, "like and subscribe" framing).
- The comments treat it as a joke (laughing, quoting the bit) rather than reacting as if it were real news.
- The post is self-evidently absurd hyperbole or a recognizable meme format the room plays along with.

Answer is_satire=false for everything else, and especially:
- Content fabricated to imitate real media — fake news headlines, doctored quotes, fake official statements, deepfakes. These deceive even if "obviously fake" to some; they are NOT satire.
- A sincere false claim that a few replies happen to mock or correct.
- Anything where you are unsure. When in doubt, is_satire=false — a missed joke is cheap, a wrongly-skipped real correction is not.

Reason first, then give the verdict.

Return JSON: {"reasoning": "...", "is_satire": true|false}`;

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "satire_detector",
    strict: true,
    schema: {
      type: "object",
      properties: {
        reasoning: { type: "string", description: "One or two sentences naming the signals, written BEFORE the verdict." },
        is_satire: { type: "boolean", description: "True only when the audience is unmistakably in on the joke." },
      },
      required: ["reasoning", "is_satire"],
      additionalProperties: false,
    },
  },
};

export async function runSatireDetector(postContext: string): Promise<SatireResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = config.satire_model ?? config.note_judge_model ?? config.model;

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: postContext },
  ];
  log?.set(`${STEP.satireDetector}.messages.0`, { systemPrompt: SYSTEM_PROMPT, userMessage: postContext, model });

  const parsed = await runJsonLlmCall<{ is_satire: boolean; reasoning: string }>({
    costName: COST.satireDetector,
    model,
    messages,
    responseFormat: RESPONSE_FORMAT,
    schemaHint: `{ "reasoning": string, "is_satire": boolean }`,
  });
  log?.set(`${STEP.satireDetector}.messages.1`, { content: parsed });

  return { isSatire: !!parsed.is_satire, reasoning: parsed.reasoning ?? "" };
}
