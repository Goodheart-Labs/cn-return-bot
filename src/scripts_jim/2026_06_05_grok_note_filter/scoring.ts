/**
 * Shared scoring for the Grok note-filter eval: confusion matrix, metrics, and
 * the per-version result / false-negative / false-positive JSON outputs.
 * Used by both run.ts (after a live run) and recompute.ts (re-score from disk).
 *
 * "needs note" is the positive class. Ground truth = simple-bot's label.
 *   FN = label wants_note but Grok says no  -> the critical metric (keep low)
 *   TN = label no_note   and Grok says no  -> "correctly filtered" (want many)
 */
import { writeFileSync } from "fs";
import { join } from "path";
import type { PromptVersion } from "./filter";

export interface RowResult {
  runId: string;
  tweetId: string;
  tweetUrl: string;
  label: "wants_note" | "no_note";
  outcome: string;
  outcomeReason: string | null;
  tweetText: string | null;
  grokNeedsNote: boolean | null;
  grokReason: string;
  searchCalls: number;
  citations: string[];
  costUsd: number | null;
  error?: string;
}

export interface Metrics {
  version: PromptVersion;
  n: number;
  errored: number; // Grok returned no decision after retries
  positives: number; // label wants_note
  negatives: number; // label no_note
  tp: number;
  fn: number;
  tn: number;
  fp: number;
  falseNegativeRate: number | null; // FN / positives  (LOW is good)
  correctlyFilteredRate: number | null; // TN / negatives (HIGH is good)
  totalFilteredOut: number; // grok says no  (FN + TN)
  totalCostUsd: number;
  fnByReason: Record<string, number>;
}

export function computeMetrics(version: PromptVersion, results: RowResult[]): Metrics {
  const scored = results.filter((r) => r.grokNeedsNote !== null);
  const positives = scored.filter((r) => r.label === "wants_note");
  const negatives = scored.filter((r) => r.label === "no_note");
  const tp = positives.filter((r) => r.grokNeedsNote === true).length;
  const fn = positives.filter((r) => r.grokNeedsNote === false).length;
  const tn = negatives.filter((r) => r.grokNeedsNote === false).length;
  const fp = negatives.filter((r) => r.grokNeedsNote === true).length;

  const fnByReason: Record<string, number> = {};
  for (const r of positives.filter((r) => r.grokNeedsNote === false)) {
    const key = r.outcomeReason ?? `(${r.outcome})`;
    fnByReason[key] = (fnByReason[key] ?? 0) + 1;
  }

  return {
    version,
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
    totalCostUsd: results.reduce((s, r) => s + (r.costUsd ?? 0), 0),
    fnByReason,
  };
}

/** Write results + false-negative/positive JSONs for one version; return metrics. */
export function writeScoringOutputs(dir: string, version: PromptVersion, results: RowResult[]): Metrics {
  writeFileSync(join(dir, `results_${version}.json`), JSON.stringify(results, null, 2));
  const falseNegatives = results.filter((r) => r.label === "wants_note" && r.grokNeedsNote === false);
  const falsePositives = results.filter((r) => r.label === "no_note" && r.grokNeedsNote === true);
  writeFileSync(join(dir, `false_negatives_${version}.json`), JSON.stringify(falseNegatives, null, 2));
  writeFileSync(join(dir, `false_positives_${version}.json`), JSON.stringify(falsePositives, null, 2));
  return computeMetrics(version, results);
}

function pct(x: number | null): string {
  return x === null ? "n/a" : `${(x * 100).toFixed(1)}%`;
}

export function formatMetrics(m: Metrics): string {
  return (
    `  TP=${m.tp} FN=${m.fn} TN=${m.tn} FP=${m.fp} errored=${m.errored}  ` +
    `(sum=${m.tp + m.fn + m.tn + m.fp + m.errored})\n` +
    `  false-negative rate (wants_note -> grok says no): ${pct(m.falseNegativeRate)}  (${m.fn}/${m.positives})\n` +
    `  correctly filtered (no_note -> grok says no):     ${pct(m.correctlyFilteredRate)}  (${m.tn}/${m.negatives})\n` +
    `  total filtered out: ${m.totalFilteredOut}/${m.n}   cost: $${m.totalCostUsd.toFixed(2)}\n` +
    `  FN by reason: ${JSON.stringify(m.fnByReason)}`
  );
}
