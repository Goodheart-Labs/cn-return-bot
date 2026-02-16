/**
 * Evaluate Predictors
 *
 * Joins prediction scores (from pipeline_scores) with actual outcomes
 * (coreNoteIntercept from public_data_snapshots) and computes how well
 * each prediction method correlates with reality.
 *
 * Usage: bun run src/scripts/evaluatePredictors.ts
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const client = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

interface ScoredNote {
  pipelineRunId: string;
  noteId: string;
  intercept: number;
  isHelpful: boolean;
  isNotHelpful: boolean;
  predictions: Record<string, number>;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return NaN;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - meanX;
    const dy = y[i]! - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

async function main() {
  // 1. Get all submitted pipeline runs with note_ids
  const { data: runs, error: runsError } = await client
    .from("pipeline_runs")
    .select("id, note_id, created_at")
    .eq("outcome", "submitted")
    .not("note_id", "is", null);

  if (runsError || !runs) {
    console.error("Error fetching pipeline runs:", runsError);
    process.exit(1);
  }

  // 2. Get latest public_data_snapshot per note_id (for coreNoteIntercept)
  const { data: snapshots, error: snapError } = await client
    .from("public_data_snapshots")
    .select("note_id, core_note_intercept, current_status, snapshot_date")
    .eq("is_ours", true)
    .not("core_note_intercept", "is", null)
    .order("snapshot_date", { ascending: false });

  if (snapError) {
    console.error("Error fetching snapshots:", snapError);
    process.exit(1);
  }

  // Latest intercept per note
  const interceptByNoteId = new Map<string, number>();
  for (const snap of snapshots || []) {
    if (!interceptByNoteId.has(snap.note_id) && snap.core_note_intercept != null) {
      interceptByNoteId.set(snap.note_id, parseFloat(snap.core_note_intercept));
    }
  }

  // 3. Get all prediction scores
  const runIds = runs.map((r) => r.id);
  // Fetch in batches to avoid URL length limits
  const allScores: Array<{ pipeline_run_id: string; score_type: string; score_value: number; created_at: string }> = [];
  const BATCH_SIZE = 200;
  for (let i = 0; i < runIds.length; i += BATCH_SIZE) {
    const batch = runIds.slice(i, i + BATCH_SIZE);
    const { data: scores } = await client
      .from("pipeline_scores")
      .select("pipeline_run_id, score_type, score_value, created_at")
      .in("pipeline_run_id", batch)
      .not("score_value", "is", null);
    if (scores) allScores.push(...scores);
  }

  // Also include the "evaluation" score type (already stored at submission time)
  const predScoreTypes = new Set<string>();
  for (const s of allScores) {
    if (s.score_type.startsWith("pred_") || s.score_type === "evaluation") {
      predScoreTypes.add(s.score_type);
    }
  }

  // 4. Build scored notes
  const scoredNotes: ScoredNote[] = [];
  const runMap = new Map(runs.map((r) => [r.id, r]));

  // Group scores by pipeline_run_id
  const scoresByRun = new Map<string, Map<string, { value: number; createdAt: string }>>();
  for (const s of allScores) {
    if (!predScoreTypes.has(s.score_type)) continue;
    if (!scoresByRun.has(s.pipeline_run_id)) scoresByRun.set(s.pipeline_run_id, new Map());
    scoresByRun.get(s.pipeline_run_id)!.set(s.score_type, { value: s.score_value, createdAt: s.created_at });
  }

  for (const run of runs) {
    const intercept = interceptByNoteId.get(run.note_id);
    if (intercept === undefined) continue; // No ground truth yet

    const predMap = scoresByRun.get(run.id);
    if (!predMap || predMap.size === 0) continue; // No predictions

    const predictions: Record<string, number> = {};
    for (const [type, data] of predMap) {
      predictions[type] = data.value;
    }

    scoredNotes.push({
      pipelineRunId: run.id,
      noteId: run.note_id,
      intercept,
      isHelpful: intercept > 0.4,
      isNotHelpful: intercept < -0.04,
      predictions,
    });
  }

  if (scoredNotes.length === 0) {
    console.log("No notes found with both predictions and coreNoteIntercept ground truth.");
    console.log(`Pipeline runs: ${runs.length}`);
    console.log(`Notes with intercept: ${interceptByNoteId.size}`);
    console.log(`Prediction scores: ${allScores.length}`);
    process.exit(0);
  }

  // 5. Evaluate each predictor
  console.log(`\n=== PREDICTOR EVALUATION ===`);
  console.log(`Notes with ground truth + predictions: ${scoredNotes.length}`);
  console.log(`Helpful (>0.4): ${scoredNotes.filter((n) => n.isHelpful).length}`);
  console.log(`Not helpful (<-0.04): ${scoredNotes.filter((n) => n.isNotHelpful).length}`);
  console.log(`In between: ${scoredNotes.filter((n) => !n.isHelpful && !n.isNotHelpful).length}\n`);

  const results: Array<{
    scoreType: string;
    n: number;
    correlation: number;
    helpfulMean: number;
    notHelpfulMean: number;
    separation: number;
  }> = [];

  for (const scoreType of predScoreTypes) {
    const paired = scoredNotes
      .filter((n) => n.predictions[scoreType] !== undefined)
      .map((n) => ({
        pred: n.predictions[scoreType]!,
        actual: n.intercept,
        helpful: n.isHelpful,
        notHelpful: n.isNotHelpful,
      }));

    if (paired.length < 2) continue;

    const preds = paired.map((p) => p.pred);
    const actuals = paired.map((p) => p.actual);
    const correlation = pearsonCorrelation(preds, actuals);

    const helpfulPreds = paired.filter((p) => p.helpful).map((p) => p.pred);
    const notHelpfulPreds = paired.filter((p) => p.notHelpful).map((p) => p.pred);

    const helpfulMean = helpfulPreds.length > 0
      ? helpfulPreds.reduce((a, b) => a + b, 0) / helpfulPreds.length
      : NaN;
    const notHelpfulMean = notHelpfulPreds.length > 0
      ? notHelpfulPreds.reduce((a, b) => a + b, 0) / notHelpfulPreds.length
      : NaN;

    const separation = !isNaN(helpfulMean) && !isNaN(notHelpfulMean)
      ? helpfulMean - notHelpfulMean
      : NaN;

    results.push({
      scoreType,
      n: paired.length,
      correlation,
      helpfulMean,
      notHelpfulMean,
      separation,
    });
  }

  // Sort by correlation (best first)
  results.sort((a, b) => {
    const ca = isNaN(a.correlation) ? -999 : a.correlation;
    const cb = isNaN(b.correlation) ? -999 : b.correlation;
    return cb - ca;
  });

  console.log("LEADERBOARD (sorted by correlation with coreNoteIntercept):\n");
  console.log(
    "Predictor".padEnd(28) +
    "N".padStart(5) +
    "Corr".padStart(8) +
    "Help avg".padStart(10) +
    "NH avg".padStart(10) +
    "Sep".padStart(8)
  );
  console.log("\u2500".repeat(69));

  for (const r of results) {
    const corr = isNaN(r.correlation) ? "N/A" : r.correlation.toFixed(3);
    const hm = isNaN(r.helpfulMean) ? "N/A" : r.helpfulMean.toFixed(3);
    const nhm = isNaN(r.notHelpfulMean) ? "N/A" : r.notHelpfulMean.toFixed(3);
    const sep = isNaN(r.separation) ? "N/A" : r.separation.toFixed(3);

    console.log(
      r.scoreType.padEnd(28) +
      String(r.n).padStart(5) +
      String(corr).padStart(8) +
      String(hm).padStart(10) +
      String(nhm).padStart(10) +
      String(sep).padStart(8)
    );
  }

  // 6. Human prediction over time (if any pred_human scores exist)
  const humanNotes = scoredNotes.filter((n) => n.predictions["pred_human"] !== undefined);
  if (humanNotes.length > 0) {
    console.log(`\n=== HUMAN PREDICTION OVER TIME ===`);
    console.log(`Total human predictions with ground truth: ${humanNotes.length}\n`);

    // Get timestamps for human predictions
    const humanTimestamps = new Map<string, string>();
    for (const s of allScores) {
      if (s.score_type === "pred_human") {
        humanTimestamps.set(s.pipeline_run_id, s.created_at);
      }
    }

    // Sort by prediction date
    const sorted = humanNotes
      .map((n) => ({
        date: humanTimestamps.get(n.pipelineRunId) || "",
        predicted: n.predictions["pred_human"]!,
        actual: n.intercept,
        error: Math.abs(n.predictions["pred_human"]! - n.intercept),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Rolling window stats
    const WINDOW = 5;
    console.log("Date".padEnd(22) + "Pred".padStart(8) + "Actual".padStart(8) + "Error".padStart(8) + `  Roll${WINDOW} MAE`);
    console.log("\u2500".repeat(55));

    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i]!;
      const windowStart = Math.max(0, i - WINDOW + 1);
      const windowErrors = sorted.slice(windowStart, i + 1).map((x) => x.error);
      const rollingMAE = windowErrors.reduce((a, b) => a + b, 0) / windowErrors.length;

      const dateStr = s.date ? new Date(s.date).toISOString().slice(0, 16) : "unknown";
      console.log(
        dateStr.padEnd(22) +
        s.predicted.toFixed(3).padStart(8) +
        s.actual.toFixed(3).padStart(8) +
        s.error.toFixed(3).padStart(8) +
        `  ${rollingMAE.toFixed(3)}`
      );
    }

    const overallMAE = sorted.reduce((sum, s) => sum + s.error, 0) / sorted.length;
    console.log(`\nOverall MAE: ${overallMAE.toFixed(3)}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
