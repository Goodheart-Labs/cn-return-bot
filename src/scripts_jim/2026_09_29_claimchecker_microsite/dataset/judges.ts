/**
 * The two Muse judges of the evals. Each is one JSON call that reads the case
 * and answers with its reason first, then its verdict. They run outside any
 * model override, so they use production's Muse model whatever the run tests.
 */
import { getCostTracker, trackLlmCall, trackedLlmCreate, withCostTracker } from "../../../pipeline/cost-tracking/costTracker";
import { extractionModels } from "../../../everything/pipeline/model";
import { jsonSchemaResponseFormat } from "../../../pipeline/prompts/responseFormat";
import { parseJsonWithRetry } from "../../../pipeline/utils/jsonLlmCall";
import { stripJsonFences } from "../../../pipeline/utils/jsonOutput";
import type { JudgeAnswer, QualityAnswer } from "./evalTypes";

const JUDGE_REASONING = "medium";

const EXTRACTION_JUDGE_PROMPT = `You check whether a list of extracted claims contains a given claim.

You get a reference claim, the passage of the text it comes from, and a numbered list of extracted claims. The list contains the reference claim if one listed claim, or several listed claims together, state the same checkable fact, even in other words. The extractor splits compound statements into several claims, so every part of the reference claim must be stated by some listed claim. A claim that only mentions the topic, leaves out a checkable part, or states something different does not count.

Extracted claims should be atomic: each states one thing that could be checked on its own. "atomic" is true when every claim you matched is atomic, and false when a matching claim bundles several separate statements together, for example two facts joined by "and". When nothing matched, "atomic" is true.

Answer with JSON: { "reason": string, "matching_claims": number[], "found": boolean, "atomic": boolean }. Write the reason first.`;

const QUALITY_JUDGE_PROMPT = `You compare a community note written by a pipeline with the correction a human expert says is right.

You get a claim, one or more reference corrections and the pipeline's note. The note makes the same correction if its main point is that of any reference correction, or is consistent with it and at least as specific. A note about a different point, or one that contradicts every reference, does not.

Answer with JSON: { "reason": string, "same_point": boolean }.`;

const EXTRACTION_JUDGE_FORMAT = jsonSchemaResponseFormat("extraction_judgement", {
  type: "object",
  properties: {
    reason: { type: "string" },
    matching_claims: { type: "array", items: { type: "integer" } },
    found: { type: "boolean" },
    atomic: { type: "boolean" },
  },
  required: ["reason", "matching_claims", "found", "atomic"],
  additionalProperties: false,
});

const QUALITY_JUDGE_FORMAT = jsonSchemaResponseFormat("note_quality_judgement", {
  type: "object",
  properties: { reason: { type: "string" }, same_point: { type: "boolean" } },
  required: ["reason", "same_point"],
  additionalProperties: false,
});

interface JudgeCall<T> {
  source: string;
  system: string;
  user: string;
  format: ReturnType<typeof jsonSchemaResponseFormat>;
  schemaHint: string;
  parse: (toParse: string) => T;
}

async function askJudge<T>(params: JudgeCall<T>): Promise<T> {
  return parseJsonWithRetry<T>({
    source: params.source,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
    schemaHint: params.schemaHint,
    call: async (messages, attempt) => {
      const { response, costEntry } = await trackedLlmCreate(attempt === 1 ? params.source : `${params.source}.retry.${attempt - 1}`, {
        model: extractionModels().model,
        messages,
        response_format: params.format,
        reasoning_effort: JUDGE_REASONING,
      } as any);
      trackLlmCall(costEntry);
      const answer = (response as any).choices?.[0]?.message?.content ?? "{}";
      return { toParse: stripJsonFences(answer), assistantEcho: answer };
    },
    parse: params.parse,
  });
}

/** Runs `fn` and returns its value with the cost of every model call inside it. */
export async function withCost<T>(fn: () => Promise<T>): Promise<{ value: T; costUsd: number }> {
  return withCostTracker(async () => {
    const value = await fn();
    return { value, costUsd: getCostTracker().reduce((sum, entry) => sum + entry.cost, 0) };
  });
}

export async function judgeExtraction(referenceClaim: string, passage: string, claims: string[]): Promise<{ answer: JudgeAnswer; costUsd: number }> {
  const numbered = claims.map((claim, i) => `${i + 1}. ${claim}`).join("\n");
  const { value, costUsd } = await withCost(() =>
    askJudge<JudgeAnswer>({
      source: "eval_extraction_judge",
      system: EXTRACTION_JUDGE_PROMPT,
      user: `Reference claim: ${referenceClaim}\n\nPassage: ${passage}\n\nExtracted claims:\n${numbered}`,
      format: EXTRACTION_JUDGE_FORMAT,
      schemaHint: `{ "reason": string, "matching_claims": number[], "found": boolean, "atomic": boolean }`,
      parse: (toParse) => {
        const raw = JSON.parse(toParse);
        const shapeOk =
          typeof raw.reason === "string" && typeof raw.found === "boolean" && typeof raw.atomic === "boolean" && Array.isArray(raw.matching_claims) && raw.matching_claims.every(Number.isInteger);
        if (!shapeOk) throw new Error("extraction judge JSON missing reason/matching_claims/found/atomic");
        return { found: raw.found, atomic: raw.atomic, matchingClaims: raw.matching_claims, reason: raw.reason };
      },
    }),
  );
  return { answer: value, costUsd };
}

export async function judgeNoteQuality(claim: string, referenceNotes: string[], note: string): Promise<{ answer: QualityAnswer; costUsd: number }> {
  const { value, costUsd } = await withCost(() =>
    askJudge<QualityAnswer>({
      source: "eval_note_quality_judge",
      system: QUALITY_JUDGE_PROMPT,
      user: `Claim: ${claim}\n\nReference corrections: ${referenceNotes.join("\n")}\n\nPipeline note: ${note}`,
      format: QUALITY_JUDGE_FORMAT,
      schemaHint: `{ "reason": string, "same_point": boolean }`,
      parse: (toParse) => {
        const raw = JSON.parse(toParse);
        if (typeof raw.reason !== "string" || typeof raw.same_point !== "boolean") throw new Error("quality judge JSON missing reason/same_point");
        return { samePoint: raw.same_point, reason: raw.reason };
      },
    }),
  );
  return { answer: value, costUsd };
}
