/**
 * High Bar Submission Filter
 *
 * When enabled (HIGH_BAR_SUBMISSION_FILTER=true), raises the submission bar significantly.
 * Use this when the NH_5 safety valve is tripped (3+ of last 5 rated notes = Not Helpful)
 * and every submission slot matters.
 *
 * Checks (in order, cheapest first):
 * 1. X eval score (claim_opinion_score) must be >= 0.5 (normally >= 0)
 * 2. Source trust score must be >= 0.4 (free, no API call)
 * 3. LLM helpfulness prediction must be >= 0.6
 *
 * Any check that fails = note is rejected. This is intentionally aggressive.
 */

import { scoreSourceTrustworthiness } from "../pipeline/sourceTrustworthiness";
import { predictHelpfulness } from "../pipeline/scoringFilters";

export interface HighBarFilterResult {
  passed: boolean;
  reason?: string;
  scores: {
    evalScore?: number;
    sourceTrust?: number;
    llmHelpfulness?: number;
  };
}

// Thresholds — tuned from correlation analysis (Mar 2026)
const EVAL_THRESHOLD = 0.5;
const SOURCE_TRUST_THRESHOLD = 0.4;
const LLM_HELPFULNESS_THRESHOLD = 0.6;

export function isHighBarFilterEnabled(): boolean {
  return process.env.HIGH_BAR_SUBMISSION_FILTER === "true";
}

/**
 * Run the high bar filter checks on a note that has already passed
 * the normal eval filter. Returns whether the note should still be submitted.
 */
export async function runHighBarFilter(
  evalScore: number | undefined,
  sourceUrl: string,
  noteText: string,
  tweetText: string,
  searchResults: string
): Promise<HighBarFilterResult> {
  const scores: HighBarFilterResult["scores"] = {};

  // 1. X eval score check (free — we already have it)
  if (evalScore !== undefined) {
    scores.evalScore = evalScore;
    if (evalScore < EVAL_THRESHOLD) {
      return {
        passed: false,
        reason: `eval score ${evalScore.toFixed(3)} < ${EVAL_THRESHOLD}`,
        scores,
      };
    }
  }

  // 2. Source trust check (free — pure domain lookup)
  if (sourceUrl) {
    const trust = scoreSourceTrustworthiness(sourceUrl);
    scores.sourceTrust = trust.score;
    if (trust.score < SOURCE_TRUST_THRESHOLD) {
      return {
        passed: false,
        reason: `source trust ${trust.score.toFixed(2)} < ${SOURCE_TRUST_THRESHOLD} (${sourceUrl})`,
        scores,
      };
    }
  }

  // 3. LLM helpfulness prediction (costs an API call — only if we passed the cheap checks)
  try {
    const helpfulness = await predictHelpfulness(noteText, tweetText, searchResults, sourceUrl);
    scores.llmHelpfulness = helpfulness.score;
    if (helpfulness.score < LLM_HELPFULNESS_THRESHOLD) {
      return {
        passed: false,
        reason: `LLM helpfulness ${helpfulness.score.toFixed(2)} < ${LLM_HELPFULNESS_THRESHOLD}`,
        scores,
      };
    }
  } catch (err: any) {
    // If LLM fails, let it through — don't block on prediction failures
    console.warn(`[highBarFilter] LLM helpfulness check failed, allowing through:`, err?.message);
  }

  return { passed: true, scores };
}
