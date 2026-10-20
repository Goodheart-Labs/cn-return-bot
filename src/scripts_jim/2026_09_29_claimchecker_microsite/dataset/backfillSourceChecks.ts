/** Fills what the source verifier was given and answered into saved runs, from the logs of the checks. */
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { LAB_DIR } from "../runStore";
import { sourceChecksOf } from "./checkerEval";

const RUNS_DIR = join(import.meta.dir, "evalRuns");

for (const file of readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"))) {
  const run = JSON.parse(readFileSync(join(RUNS_DIR, file), "utf8"));
  let filled = 0;
  for (const row of run.checker?.rows ?? []) {
    for (const sample of row.samples) {
      if (sample.sourceChecks !== undefined) continue;
      // The newest log is the one that ran the source verifier last.
      for (const logFile of [...(sample.logFiles ?? [])].reverse()) {
        const [, folder, name] = logFile.match(/^logs\/([^/]+)\/(.+)$/)!;
        const checks = sourceChecksOf(JSON.parse(readFileSync(join(LAB_DIR, "logs", folder, name), "utf8")).logs);
        if (checks.length) {
          sample.sourceChecks = checks;
          filled++;
          break;
        }
      }
    }
  }
  writeFileSync(join(RUNS_DIR, file), JSON.stringify(run, null, 1));
  if (filled) console.log(`${file}: ${filled} samples with source checks`);
}
