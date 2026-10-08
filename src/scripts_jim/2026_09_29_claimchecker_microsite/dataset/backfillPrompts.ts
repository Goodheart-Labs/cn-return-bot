/**
 * Fills in the prompts of a run that was saved before the checker eval kept
 * them, from the logs the run wrote to disk. It changes nothing else in the
 * run file.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/backfillPrompts.ts <run id>
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { LAB_DIR, LOGS_DIR } from "../runStore";
import { promptsOf } from "./checkerEval";
import type { EvalRun } from "./evalTypes";

const runId = process.argv[2];
if (!runId) throw new Error("Give the run id");
const path = join(LAB_DIR, "dataset", "evalRuns", `${runId}.json`);
const run: EvalRun = JSON.parse(readFileSync(path, "utf8"));
let filled = 0;
for (const row of run.checker?.rows ?? []) {
  row.samples.forEach((sample, index) => {
    const log = JSON.parse(readFileSync(join(LOGS_DIR, `eval-${runId}`, `${row.id}.${index}.json`), "utf8"));
    sample.prompts = promptsOf(log.logs);
    filled++;
  });
}
writeFileSync(path, JSON.stringify(run, null, 1));
console.log(`Filled the prompts of ${filled} samples in ${path}`);
