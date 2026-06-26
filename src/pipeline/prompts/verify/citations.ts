/**
 * Shared citation unit for the source verifier's "citations" mode
 * (verifier_citations A/B test). In both the classic and claim-based flows the
 * model evaluates a source by first gathering verbatim snippets + a
 * plain-language explanation of how each does/doesn't support the note, THEN
 * judging good/bad — reason-then-judge, which exploits autoregressive decoding.
 *
 * This module holds the one place that shape is defined: the TS types
 * (SourceCitation, EvaluatedSource), the strict-schema fragment both flows embed
 * (EVALUATED_SOURCE_SCHEMA), and the prompt fragment both prompts append.
 */

export interface SourceCitation {
  /** Verbatim snippet copied from the source's fetched content. */
  quote: string;
  /** Concise, plain-language note (for non-experts) on how this snippet supports
   *  or fails to support the note. "" when self-evident. */
  explanation: string;
}

/** A source's evidence gathered BEFORE its verdict. Same unit in both flows. */
export interface EvaluatedSource {
  url: string;
  citations: SourceCitation[];
  verdict: "good" | "bad";
}

const CITATIONS_SCHEMA = {
  type: "array",
  description:
    "Most relevant verbatim snippets from this source, gathered BEFORE the verdict. Empty only when the source failed to fetch or has nothing relevant.",
  items: {
    type: "object",
    properties: {
      quote: { type: "string", description: "Text copied verbatim from the shown source content. Never invent or paraphrase." },
      explanation: {
        type: "string",
        description:
          'Concise, plain-language note (for non-experts) on how this snippet supports or fails to support the note. "" when self-evident.',
      },
    },
    required: ["quote", "explanation"],
    additionalProperties: false,
  },
};

/** Per-source schema fragment: url → citations → verdict. Insertion order is the
 *  generation order, so the model produces its evidence before the verdict.
 *  Embedded as the `items` of the `sources` array in both verifier flows. */
export const EVALUATED_SOURCE_SCHEMA = {
  type: "object",
  properties: {
    url: { type: "string", description: "Verbatim cited URL." },
    citations: CITATIONS_SCHEMA,
    verdict: { type: "string", enum: ["good", "bad"], description: "Final judgement after weighing the citations." },
  },
  required: ["url", "citations", "verdict"],
  additionalProperties: false,
};

/** Appended to both verifier prompts when citations is on. */
export const CITATIONS_PROMPT_FRAGMENT = `For each source list its "citations" FIRST, each a { quote, explanation }:
- quote: text copied verbatim from that source's shown content (never invented or paraphrased).
- explanation: a concise, plain-language note (for readers not deep in the topic) on how the snippet supports — or fails to support — a factual claim in the note. Use "" when self-evident.
Gather the citations BEFORE the verdict, then judge "good"/"bad" from them. Leave citations empty only when the source failed to fetch or has nothing relevant.`;
