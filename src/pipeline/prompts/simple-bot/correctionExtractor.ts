/**
 * Prompt — simple-bot correction extractor.
 *
 * The extractor runs between the search and the writer, and only when
 * `config.correction_extraction` is on. It breaks the search findings into
 * separate atomic corrections and grades each one. The orchestrator keeps the
 * high-value grades and passes them through formatCorrectionsForWriter, so the
 * writer sees only those. See runCorrectionExtractor in
 * src/pipeline/simple-bot/correctionExtractor.ts.
 */

import { jsonSchemaResponseFormat } from "../responseFormat";

export type CorrectionCategory =
  | "clear_error"
  | "minor_error"
  | "critical_context"
  | "useful_context"
  | "not_useful";

/** Only corrections in these categories reach the writer. When no correction
 *  lands in one of them, the post needs no correction at all. */
export const HIGH_VALUE_CATEGORIES: CorrectionCategory[] = ["clear_error", "critical_context"];

export const CORRECTION_EXTRACTOR_SYSTEM_PROMPT = `You analyze research findings about an X/Twitter post and extract every atomic correction — each a single, self-contained way the post is factually wrong or would leave a reader with a worse understanding of the world.

For each atomic correction, give it a short name, classify its importance, and write a standalone explanation of what is actually true.

## Categories
- clear_error: Corrects a clearly incorrect fact. The post states something plainly false, and the correct fact changes the picture.
- minor_error: Corrects a somewhat incorrect fact. Numbers or details are off, but within a range where the correct value doesn't really change the picture — or the gap could plausibly come from two analyses using slightly different methodologies/assumptions. An order-of-magnitude (>10x) gap is almost never minor. A <2x difference is often (not always) minor. Between 2x and 10x it depends on the topic.
- critical_context: Adds very useful context. Does not correct a claim, but without it almost every reader would come away with a clearly worse understanding — nearly all readers would rate the context useful.
- useful_context: Adds otherwise useful context. Helpful but not essential.
- not_useful: Does not add useful context.

## Fields
- name: a short label for the correction, e.g. "video is AI generated".
- explanation:
  - Must stand alone: state what is actually true and why the post is wrong or incomplete.
  - Include the full https:// source URL inline next to each claim it supports — never footnote numbers or domain shortcuts.
  - You may copy sentences (and their source URLs) from the findings verbatim — 1:1.
  - Use only the research findings provided. Do not invent facts or sources.

## Output
Return JSON: { "corrections": [ { "name": string, "category": <one of the five>, "explanation": string } ] }
Return an empty array if the findings support no corrections at all.`;

export const CORRECTION_EXTRACTOR_RESPONSE_FORMAT = jsonSchemaResponseFormat(
  "simple_bot_correction_extraction",
  {
    type: "object",
    properties: {
      corrections: {
        type: "array",
        description: "Every atomic correction found in the research findings.",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: 'Short label for this correction, e.g. "video is AI generated".',
            },
            category: {
              type: "string",
              enum: ["clear_error", "minor_error", "critical_context", "useful_context", "not_useful"],
              description:
                "Importance grade. clear_error = clearly incorrect fact; minor_error = somewhat incorrect fact (small/within-error-bar difference); critical_context = adds context almost every reader would find useful; useful_context = otherwise useful context; not_useful = adds nothing useful.",
            },
            explanation: {
              type: "string",
              description:
                "Standalone explanation of what is actually true / what context is missing, with full https:// source URLs inline. Text and URLs may be copied from the findings verbatim; nothing invented.",
            },
          },
          required: ["name", "category", "explanation"],
          additionalProperties: false,
        },
      },
    },
    required: ["corrections"],
    additionalProperties: false,
  },
);

/** Turns the high-value corrections into the string the writer receives in place
 *  of the raw search dump. The string has the same shape as the findings. Each
 *  correction becomes one block, with its `name` as the heading and its
 *  explanation below. The category only serves to filter the corrections
 *  upstream, and the writer never sees it. The extractor's own user message is
 *  nothing but the raw findings, which is why this file has no buildUserMessage
 *  helper. */
export function formatCorrectionsForWriter(
  corrections: { name: string; explanation: string }[],
): string {
  return corrections.map((c) => `### ${c.name}\n${c.explanation}`).join("\n\n");
}
