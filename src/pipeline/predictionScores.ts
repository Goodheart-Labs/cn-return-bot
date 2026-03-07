/**
 * Prediction Scores
 *
 * Runs multiple prediction methods after a note is submitted and stores
 * each score in pipeline_scores. Used to evaluate which methods best
 * predict the actual coreNoteIntercept (helpfulness score).
 *
 * All predictors output a single decimal number. None gate submission.
 */

import { SupabaseLogger } from "../api/supabaseClient";
import {
  checkPositiveClaims,
  checkSubstantiveDisagreement,
  scoreBridging,
  scoreSaysWrong,
  countSources,
} from "./scoringFilters";
import { evaluateNote } from "../filters/noteEvaluationFilter";

interface PredictionContext {
  pipelineRunId: string;
  noteText: string;
  sourceUrl: string;
  tweetText: string;
  searchResults: string;
  postId: string;
  supabaseLogger: SupabaseLogger;
  /** Pre-computed scores from earlier pipeline stages (suppressor, eval check) — skip re-computing these */
  preComputed?: {
    bridging?: number;
    saysWrong?: number;
    sourceCount?: number;
    claimOpinionScore?: number;
  };
}

async function runSinglePredictor(
  name: string,
  fn: () => Promise<number | undefined>,
  ctx: PredictionContext
): Promise<void> {
  try {
    const value = await fn();
    if (value !== undefined) {
      await ctx.supabaseLogger.addPipelineScore(ctx.pipelineRunId, {
        score_type: name,
        score_value: value,
      });
    }
  } catch (err: any) {
    console.warn(`[predictionScores] ${name} failed:`, err?.message || err);
    try {
      await ctx.supabaseLogger.addPipelineScore(ctx.pipelineRunId, {
        score_type: name,
        score_metadata: { error: (err?.message || String(err)).slice(0, 500) },
      });
    } catch {
      // Don't let logging failures cascade
    }
  }
}

/**
 * Run all prediction methods in parallel and store scores.
 * Fire-and-forget — never throws, never blocks submission.
 */
export async function runPredictionScores(ctx: PredictionContext): Promise<void> {
  console.log(`[predictionScores] Running predictions for pipeline run ${ctx.pipelineRunId}...`);

  await Promise.all([
    // LLM: bridging score (0-1) — r=0.558 with outcome
    // Skip if preComputed — already stored by generateCandidates
    ctx.preComputed?.bridging === undefined
      ? runSinglePredictor("pred_bridging", async () => {
          const result = await scoreBridging(ctx.noteText);
          return result.score;
        }, ctx)
      : Promise.resolve(),

    // LLM: says-wrong score (0-1) — r=0.312 with outcome
    ctx.preComputed?.saysWrong === undefined
      ? runSinglePredictor("pred_says_wrong", async () => {
          const result = await scoreSaysWrong(ctx.noteText);
          return result.score;
        }, ctx)
      : Promise.resolve(),

    // Free: source/URL count — r=0.335 with outcome
    ctx.preComputed?.sourceCount === undefined
      ? runSinglePredictor("pred_source_count", async () => {
          return countSources(ctx.noteText);
        }, ctx)
      : Promise.resolve(),

    // LLM: positive claims check (0-1)
    runSinglePredictor("pred_llm_positive_claims", async () => {
      const result = await checkPositiveClaims(ctx.noteText);
      return result.score;
    }, ctx),

    // LLM: substantive disagreement (0-1)
    runSinglePredictor("pred_llm_disagreement", async () => {
      const result = await checkSubstantiveDisagreement(ctx.noteText, ctx.tweetText);
      return result.score;
    }, ctx),

    // X API: claim opinion score (unbounded decimal)
    ctx.preComputed?.claimOpinionScore === undefined
      ? runSinglePredictor("pred_x_claim_opinion", async () => {
          const result = await evaluateNote(ctx.postId, ctx.noteText);
          if (result.data && typeof result.data.claim_opinion_score === "number") {
            return result.data.claim_opinion_score;
          }
          return undefined;
        }, ctx)
      : Promise.resolve(),
  ]);

  console.log(`[predictionScores] All predictions complete for pipeline run ${ctx.pipelineRunId}`);
}
