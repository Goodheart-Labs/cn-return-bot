/** Fills `draftSources` into saved runs from the logs of their checks. A sample carried over from an earlier run has its log in that run's folder, so the folders are searched newest first for the log whose drafted note matches. */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { LOGS_DIR } from "../runStore";
import { checkTraceOf } from "../labRun";

const RUNS_DIR = join(import.meta.dir, "evalRuns");
const logFolders = readdirSync(LOGS_DIR).filter((f) => f.startsWith("eval-")).sort().reverse();

function sourcesOf(rowId: string, sample: number, runId: string, draftNote: string): string[] | null {
  const folders = [`eval-${runId}`, ...logFolders.filter((f) => f !== `eval-${runId}`)];
  for (const folder of folders) {
    const file = join(LOGS_DIR, folder, `${rowId}.${sample}.json`);
    if (!existsSync(file)) continue;
    const trace = checkTraceOf(JSON.parse(readFileSync(file, "utf8")).logs);
    if (trace.draftNote === draftNote) return trace.draftSources;
  }
  return null;
}

for (const file of readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"))) {
  const run = JSON.parse(readFileSync(join(RUNS_DIR, file), "utf8"));
  const runId = file.replace(".json", "");
  let filled = 0;
  for (const row of run.checker?.rows ?? []) {
    row.samples.forEach((sample: any, index: number) => {
      if (!sample.draftNote || sample.draftSources !== undefined) return;
      const sources = sourcesOf(row.id, index, runId, sample.draftNote);
      if (sources) {
        sample.draftSources = sources;
        filled++;
      }
    });
  }
  writeFileSync(join(RUNS_DIR, file), JSON.stringify(run, null, 1));
  if (filled) console.log(`${runId}: ${filled} drafts`);
}
