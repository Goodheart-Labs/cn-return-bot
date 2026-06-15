/**
 * Recompute metrics + false-negative/positive JSONs from already-saved
 * results_<version>.json, normalizing grokNeedsNote (Grok sometimes returns the
 * string "true"/"false"). No API calls — pure re-scoring of the saved run.
 * Scoring logic is shared with run.ts via scoring.ts.
 *
 *   bun run src/scripts_jim/2026_06_05_grok_note_filter/recompute.ts
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { coerceBool, type PromptVersion } from "./filter";
import { writeScoringOutputs, formatMetrics, type RowResult } from "./scoring";

const dir = import.meta.dir;
const VERSIONS: PromptVersion[] = ["neutral", "lenient"];

const allMetrics = [];
for (const version of VERSIONS) {
  const path = join(dir, `results_${version}.json`);
  if (!existsSync(path)) continue;
  const rows: RowResult[] = JSON.parse(readFileSync(path, "utf8"));
  for (const r of rows) r.grokNeedsNote = coerceBool(r.grokNeedsNote);
  const m = writeScoringOutputs(dir, version, rows);
  allMetrics.push(m);
  console.log(`=== ${version} ===\n${formatMetrics(m)}\n`);
}

writeFileSync(join(dir, "metrics.json"), JSON.stringify(allMetrics, null, 2));
console.log("Rewrote results_*, false_negatives_*, false_positives_*, metrics.json");
