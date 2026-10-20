/** Fills what the source verifier answered into saved runs, from the logs of the checks, with the log file that holds what it was given. For a check with a second round it also fills the sources of the first note, which the second round's writer entry had overwritten. */
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { LAB_DIR } from "../runStore";
import { citedSourcesOf, sourceChecksOf } from "./checkerEval";

const RUNS_DIR = join(import.meta.dir, "evalRuns");
const verifierInputOf = (logs: any, turn: number) => logs?.note_writer_steps?.source_verifier?.turn?.[String(turn)]?.messages?.["0"]?.userMessage as string | undefined;

for (const file of readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"))) {
  const run = JSON.parse(readFileSync(join(RUNS_DIR, file), "utf8"));
  let filled = 0;
  for (const row of run.checker?.rows ?? []) {
    for (const sample of row.samples) {
      // The newest log is the one that ran the source verifier last.
      for (const logFile of [...(sample.logFiles ?? [])].reverse()) {
        const [, folder, name] = logFile.match(/^logs\/([^/]+)\/(.+)$/)!;
        const logs = JSON.parse(readFileSync(join(LAB_DIR, "logs", folder, name), "utf8")).logs;
        const checks = sourceChecksOf(logs, logFile);
        if (!checks.length) continue;
        sample.sourceChecks = checks;
        const firstInput = verifierInputOf(logs, 1);
        if (sample.secondRound && !sample.secondRound.first.sources && firstInput) sample.secondRound.first.sources = citedSourcesOf(firstInput);
        filled++;
        break;
      }
    }
  }
  writeFileSync(join(RUNS_DIR, file), JSON.stringify(run, null, 1));
  if (filled) console.log(`${file}: ${filled} samples with source checks`);
}
