/**
 * Materiality / persuasion judge — SHADOW scorer.
 *
 * Runs on every written correction, logs four pipeline_scores rows, gates
 * NOTHING. Gating waits for a benchmark against the review-dashboard tags
 * (the "did not engage" / "pedantic" hand labels are ~100% predictive of
 * not-helpful; the judge must prove it catches them at an acceptable
 * false-positive rate on helpful notes first). Predecessor rubric scorers
 * (note_not_needed AUC 0.70, helpfulness 0.715) were retired for cost in #154;
 * this revives the signal at one cheap call per WRITTEN note (~35/day).
 */

import { runJsonLlmCall } from "../utils/jsonLlmCall";
import {
  MATERIALITY_JUDGE_SYSTEM_PROMPT,
  MATERIALITY_JUDGE_RESPONSE_FORMAT,
  MATERIALITY_JUDGE_SCHEMA_HINT,
  buildMaterialityJudgeUserMessage,
} from "../prompts/simple-bot/materialityJudge";

// Cheap judge model, same pick as the cheap-bot note judge (big_eval: halved
// hard-FP rate vs deepseek while gaining coverage).
const MATERIALITY_JUDGE_MODEL = "google/gemini-3-flash-preview";

export interface MaterialityVerdict {
  engages_main_claim: boolean;
  changes_takeaway: boolean;
  would_convince: boolean;
  persuasion_score: number;
  why: string;
}

export interface MaterialityScoreEntry {
  type: string;
  value: number;
  label: string;
  metadata: Record<string, unknown>;
}

/** Run the judge; returns pipeline_scores-shaped entries. Throws on LLM/parse
 *  failure — the caller catches and continues (shadow scorer must never block
 *  a run). */
export async function runMaterialityJudge(params: {
  postText: string;
  findings: string;
  noteText: string;
}): Promise<MaterialityScoreEntry[]> {
  const verdict = await runJsonLlmCall<MaterialityVerdict>({
    costName: "materialityJudge",
    model: MATERIALITY_JUDGE_MODEL,
    messages: [
      { role: "system", content: MATERIALITY_JUDGE_SYSTEM_PROMPT },
      { role: "user", content: buildMaterialityJudgeUserMessage(params) },
    ],
    responseFormat: MATERIALITY_JUDGE_RESPONSE_FORMAT,
    schemaHint: MATERIALITY_JUDGE_SCHEMA_HINT,
  });

  const meta = { why: verdict.why };
  const bool = (b: boolean) => ({ value: b ? 1 : 0, label: b ? "YES" : "NO" });
  return [
    { type: "materiality_engages", ...bool(verdict.engages_main_claim), metadata: meta },
    { type: "materiality_takeaway", ...bool(verdict.changes_takeaway), metadata: meta },
    { type: "materiality_convince", ...bool(verdict.would_convince), metadata: meta },
    {
      type: "materiality_overall",
      value: verdict.persuasion_score,
      label: verdict.persuasion_score >= 0.5 ? "PASS" : "FAIL",
      metadata: meta,
    },
  ];
}
