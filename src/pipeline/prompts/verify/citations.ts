/**
 * The shared citation unit for the source verifier's "citations" mode, which is
 * the verifier_citations A/B test.
 *
 * The classic flow and the claim-based flow evaluate a source the same way. The
 * model first gathers verbatim snippets from the source. For each snippet it
 * writes a plain-language explanation of how that snippet supports the note, or
 * fails to support it. Only then does it judge the source good or bad. Making
 * the model reason before it judges helps because it writes its answer one
 * token at a time, so the verdict can lean on the text it has already written.
 *
 * This module is the single place that shape is defined. It holds the
 * TypeScript types SourceCitation and EvaluatedSource, the strict schema
 * fragment EVALUATED_SOURCE_SCHEMA that both flows embed, and the prompt
 * fragment that both prompts append.
 */

export interface SourceCitation {
  /** Verbatim snippet copied from the source's fetched content. */
  quote: string;
  /** A short note in plain language, aimed at a reader who is not an expert, on
   *  how this snippet supports the note or fails to support it. It is the empty
   *  string when the connection is self-evident. */
  explanation: string;
}

/** The evidence gathered for one source before its verdict is decided. Both
 *  flows use this same unit. */
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

/** The schema fragment for one source. Its properties are listed as url, then
 *  citations, then verdict. The model generates them in that order, so it
 *  produces its evidence before its verdict. Both verifier flows embed this
 *  fragment as the `items` of their `sources` array. */
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

/** This fragment is appended to both verifier prompts when the citations mode is
 *  on. */
export const CITATIONS_PROMPT_FRAGMENT = `For each source list its "citations" FIRST, each a { quote, explanation }:
- quote: text copied verbatim from that source's shown content (never invented or paraphrased).
- explanation: a concise, plain-language note (for readers not deep in the topic) on how the snippet supports — or fails to support — a factual claim in the note. Use "" when self-evident.
Gather the citations BEFORE the verdict, then judge "good"/"bad" from them. Leave citations empty only when the source failed to fetch or has nothing relevant.`;
