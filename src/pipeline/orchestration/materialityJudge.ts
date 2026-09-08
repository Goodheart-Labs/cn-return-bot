/**
 * The materiality and persuasion judge.
 *
 * It runs on every correction we write and logs four rows into pipeline_scores.
 * Whether it also gates submission is decided by the materiality_gate_threshold
 * config field, which MATERIALITY_TREATMENT_TEST sets on its judge_gate arm.
 * Five weeks of shadow scores (Aug 4 to Sep 7, 2026) put notes it scored under
 * 0.5 at 58% helpful against 80% above, and it caught four of the seven notes
 * Nathan tagged pedantic in that window.
 *
 * Two earlier rubric scorers were retired in issue #154 because they cost too
 * much. They reached an AUC of 0.70 for note_not_needed and 0.715 for
 * helpfulness. This judge brings that signal back for one cheap call per written
 * note, which is about 35 calls a day.
 */

import { runJsonLlmCall } from "../utils/jsonLlmCall";
import {
  MATERIALITY_JUDGE_SYSTEM_PROMPT,
  MATERIALITY_JUDGE_RESPONSE_FORMAT,
  MATERIALITY_JUDGE_SCHEMA_HINT,
  buildMaterialityJudgeUserMessage,
} from "../prompts/simple-bot/materialityJudge";

// This is a cheap judge model. In
// the big_eval run it halved the rate of hard false positives compared with
// deepseek, and it still covered more cases.
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

/** Runs the judge and returns entries shaped like pipeline_scores rows. It
 *  throws when the LLM call fails or its answer cannot be parsed. The caller
 *  catches that error and carries on, so a judge outage never stops a run. */
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
