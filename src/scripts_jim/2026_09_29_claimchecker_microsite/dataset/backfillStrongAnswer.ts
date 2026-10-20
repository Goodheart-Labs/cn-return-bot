/** Fills `strongProbability` into saved runs from the logs of their checks. A sample carried over from an earlier run has its log in that run's folder, so the folders are searched newest first for the log whose findings match. */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { LOGS_DIR } from "../runStore";
import { strongAnswerOf } from "./checkerEval";

const RUNS_DIR = join(import.meta.dir, "evalRuns");
const logFolders = readdirSync(LOGS_DIR).filter((f) => f.startsWith("eval-")).sort().reverse();

function findLog(rowId: string, sample: number, runId: string, research: string): any | null {
  const folders = [`eval-${runId}`, ...logFolders.filter((f) => f !== `eval-${runId}`)];
  for (const folder of folders) {
    const file = join(LOGS_DIR, folder, `${rowId}.${sample}.json`);
    if (!existsSync(file)) continue;
    const logs = JSON.parse(readFileSync(file, "utf8")).logs;
    const findings = logs?.note_writer_steps?.search?.messages?.["1"]?.content?.findings;
    if (findings === research) return logs;
  }
  return null;
}

for (const file of readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"))) {
  const run = JSON.parse(readFileSync(join(RUNS_DIR, file), "utf8"));
  const runId = file.replace(".json", "");
  let filled = 0;
  for (const row of run.checker?.rows ?? []) {
    row.samples.forEach((sample: any, index: number) => {
      if (!sample.research || sample.strongMisleading !== undefined) return;
      const logs = findLog(row.id, index, runId, sample.research);
      const answer = logs ? strongAnswerOf(logs) : { probability: null, misleading: null };
      sample.strongProbability = answer.probability;
      sample.strongMisleading = answer.misleading;
      if (answer.probability !== null || answer.misleading !== null) filled++;
    });
  }
  writeFileSync(join(RUNS_DIR, file), JSON.stringify(run, null, 1));
  if (filled) console.log(`${runId}: ${filled} answers`);
}
