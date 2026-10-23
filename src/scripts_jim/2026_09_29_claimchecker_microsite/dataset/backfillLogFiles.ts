/** Fills `logFiles` into saved runs. A sample carried over from an earlier run has its log in that run's folder, so the folders are searched newest first. The log of the research is the one whose findings match the sample, and the log of the writer is the one whose drafted note and source check match. A quick no-note check has neither, so its log is the one whose quick findings match. */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { LOGS_DIR } from "../runStore";
import { checkTraceOf } from "../labRun";
import { cascadeOf } from "./checkerEval";

const RUNS_DIR = join(import.meta.dir, "evalRuns");
const logFolders = readdirSync(LOGS_DIR).filter((f) => f.startsWith("eval-")).sort().reverse();

type Matcher = (logs: any) => boolean;

function firstLog(rowId: string, sample: number, runId: string, matches: Matcher): string | null {
  const folders = [`eval-${runId}`, ...logFolders.filter((f) => f !== `eval-${runId}`)];
  for (const folder of folders) {
    const file = join(LOGS_DIR, folder, `${rowId}.${sample}.json`);
    if (existsSync(file) && matches(JSON.parse(readFileSync(file, "utf8")).logs)) return `logs/${folder}/${rowId}.${sample}.json`;
  }
  return null;
}

function logFilesOf(rowId: string, index: number, runId: string, sample: any): string[] {
  const researchLog = sample.research
    ? firstLog(rowId, index, runId, (logs) => checkTraceOf(logs).research === sample.research)
    : sample.cascade?.findings
      ? firstLog(rowId, index, runId, (logs) => cascadeOf(logs)?.findings === sample.cascade.findings)
      : null;
  const writerLog = sample.draftNote
    ? firstLog(rowId, index, runId, (logs) => checkTraceOf(logs).draftNote === sample.draftNote && checkTraceOf(logs).sourceVerdict === sample.sourceVerdict)
    : null;
  return [...new Set([researchLog, writerLog].filter((f): f is string => !!f))];
}

for (const file of readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"))) {
  const run = JSON.parse(readFileSync(join(RUNS_DIR, file), "utf8"));
  const runId = file.replace(".json", "");
  let filled = 0;
  for (const row of run.checker?.rows ?? []) {
    row.samples.forEach((sample: any, index: number) => {
      if (sample.logFiles !== undefined) return;
      sample.logFiles = logFilesOf(row.id, index, runId, sample);
      if (sample.logFiles.length) filled++;
    });
  }
  writeFileSync(join(RUNS_DIR, file), JSON.stringify(run, null, 1));
  console.log(`${runId}: ${filled} of ${run.checker?.rows.length * 3 || 0} samples have a log`);
}
