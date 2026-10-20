/** Fills what the second round wrote into saved runs, from the log of each check that had a second round. */
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { LAB_DIR } from "../runStore";
import { secondRoundOf } from "./checkerEval";

const RUNS_DIR = join(import.meta.dir, "evalRuns");

for (const file of readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"))) {
  const run = JSON.parse(readFileSync(join(RUNS_DIR, file), "utf8"));
  let filled = 0;
  for (const row of run.checker?.rows ?? []) {
    for (const sample of row.samples) {
      if (!sample.secondRound || sample.secondRound.second) continue;
      for (const logFile of [...(sample.logFiles ?? [])].reverse()) {
        const [, folder, name] = logFile.match(/^logs\/([^/]+)\/(.+)$/)!;
        const second = secondRoundOf(JSON.parse(readFileSync(join(LAB_DIR, "logs", folder, name), "utf8")).logs)?.second;
        if (second) {
          sample.secondRound.second = second;
          filled++;
          break;
        }
      }
    }
  }
  writeFileSync(join(RUNS_DIR, file), JSON.stringify(run, null, 1));
  if (filled) console.log(`${file}: ${filled} second rounds`);
}
