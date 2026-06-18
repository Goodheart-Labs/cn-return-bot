/**
 * Scoring for the deepseek note-filter eval: confusion matrix + metrics +
 * per-variant result / false-negative / false-positive JSON outputs.
 *
 * "needs note" is the positive class. Ground truth = simple-bot's label.
 *   FN = label wants_note but filter says no  -> the critical metric (keep low)
 *   TN = label no_note   and filter says no  -> "correctly filtered" (want many)
 */
import { writeFileSync } from "fs";
import { join } from "path";
import type { RowResult } from "./pipeline";

export interface Metrics {
  variant: string;
  n: number;
  errored: number;
  positives: number;
  negatives: number;
  tp: number;
  fn: number;
  tn: number;
  fp: number;
  falseNegativeRate: number | null; // FN / positives  (LOW is good)
  correctlyFilteredRate: number | null; // TN / negatives (HIGH is good)
  totalFilteredOut: number; // filter says no (FN + TN)
  avgCostUsd: number;
  fnByReason: Record<string, number>;
}

export function computeMetrics(variant: string, results: RowResult[]): Metrics {
  const scored = results.filter((r) => r.predNeedsNote !== null);
  const positives = scored.filter((r) => r.label === "wants_note");
  const negatives = scored.filter((r) => r.label === "no_note");
  const tp = positives.filter((r) => r.predNeedsNote === true).length;
  const fn = positives.filter((r) => r.predNeedsNote === false).length;
  const tn = negatives.filter((r) => r.predNeedsNote === false).length;
  const fp = negatives.filter((r) => r.predNeedsNote === true).length;

  const fnByReason: Record<string, number> = {};
  for (const r of positives.filter((r) => r.predNeedsNote === false)) {
    const key = r.outcomeReason ?? `(${r.outcome})`;
    fnByReason[key] = (fnByReason[key] ?? 0) + 1;
  }
  const costed = results.filter((r) => r.costUsd != null);
  return {
    variant,
    n: results.length,
    errored: results.length - scored.length,
    positives: positives.length,
    negatives: negatives.length,
    tp,
    fn,
    tn,
    fp,
    falseNegativeRate: positives.length ? fn / positives.length : null,
    correctlyFilteredRate: negatives.length ? tn / negatives.length : null,
    totalFilteredOut: fn + tn,
    avgCostUsd: costed.length ? costed.reduce((s, r) => s + (r.costUsd ?? 0), 0) / costed.length : 0,
    fnByReason,
  };
}

export function writeVariantOutputs(dir: string, variant: string, results: RowResult[]): Metrics {
  writeFileSync(join(dir, `results_${variant}.json`), JSON.stringify(results, null, 2));
  const falseNegatives = results.filter((r) => r.label === "wants_note" && r.predNeedsNote === false);
  const falsePositives = results.filter((r) => r.label === "no_note" && r.predNeedsNote === true);
  writeFileSync(join(dir, `false_negatives_${variant}.json`), JSON.stringify(falseNegatives, null, 2));
  writeFileSync(join(dir, `false_positives_${variant}.json`), JSON.stringify(falsePositives, null, 2));
  return computeMetrics(variant, results);
}

function pct(x: number | null): string {
  return x === null ? "n/a" : `${(x * 100).toFixed(1)}%`;
}

export function formatMetrics(m: Metrics): string {
  return (
    `  TP=${m.tp} FN=${m.fn} TN=${m.tn} FP=${m.fp} errored=${m.errored}  ` +
    `(sum=${m.tp + m.fn + m.tn + m.fp + m.errored})\n` +
    `  false-negative rate (wants_note -> filter says no): ${pct(m.falseNegativeRate)}  (${m.fn}/${m.positives})\n` +
    `  correctly filtered (no_note -> filter says no):     ${pct(m.correctlyFilteredRate)}  (${m.tn}/${m.negatives})\n` +
    `  total filtered out: ${m.totalFilteredOut}/${m.n}   avg cost/tweet: $${m.avgCostUsd.toFixed(4)}\n` +
    `  FN by reason: ${JSON.stringify(m.fnByReason)}`
  );
}
