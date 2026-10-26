/* Runs the note judge over the labelled notes (GOO-589, GOO-590). It runs on
 * Nathan's ai-box as the user nathan, because Claude Code uses the login in
 * his home folder. It reads data/dataset.json, which buildDataset.ts writes on
 * the devbox, and appends one line per judged note to data/<mode>.jsonl.
 * A note already in that file is skipped, so a stopped run can be started
 * again and carries on.
 *
 * zero: every labelled note, without examples.
 * few:  the older half of the notes, by the time they were written, goes into
 *       the prompt as examples, and only the newer half is judged.
 *
 * Usage: bun run src/scripts_jim/2026_10_26_note_judge/runJudges.ts <zero|few> [--parallel N] [--limit N] */

import { appendFileSync } from "fs";
import * as path from "path";
import { judgePrompt, runJudge } from "./judge";
import { readDataset, readResults, resultsPath, splitForMode, type JudgeResult, type Mode } from "./dataFiles";

/** Judges at once. Nathan's note writer shares the same weekly limit. */
const DEFAULT_PARALLEL = 3;
/** The run folders sit where Nathan's guard hook lets unattended runs write. */
const RUNS_DIR = "/tmp/cn-notes/judge";

function parseArgs() {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode !== "zero" && mode !== "few") throw new Error("Usage: runJudges.ts <zero|few> [--parallel N] [--limit N]");
  const flag = (name: string) => {
    const i = rest.indexOf(name);
    return i === -1 ? undefined : Number(rest[i + 1]);
  };
  return { mode: mode as Mode, parallel: flag("--parallel") ?? DEFAULT_PARALLEL, limit: flag("--limit") ?? Infinity };
}

async function main() {
  const { mode, parallel, limit } = parseArgs();
  const dataset = readDataset();
  const { examples, targets } = splitForMode(dataset, mode);
  const done = new Set(readResults(mode).map((r) => r.draftId));
  const todo = targets.filter((n) => !done.has(n.draftId)).slice(0, limit);
  console.log(`${mode}: ${examples.length} examples, ${targets.length} notes to judge, ${done.size} already judged, ${todo.length} now`);

  let failures = 0;
  const judgeNext = async (): Promise<void> => {
    const note = todo.shift();
    if (!note) return;
    const startedAt = Date.now();
    try {
      const judgement = await runJudge(path.join(RUNS_DIR, mode, note.draftId), judgePrompt(note, examples));
      const result: JudgeResult = { draftId: note.draftId, mode, ...judgement, seconds: Math.round((Date.now() - startedAt) / 1000) };
      appendFileSync(resultsPath(mode), JSON.stringify(result) + "\n");
      console.log(`${note.draftId}: p_helpful ${judgement.pHelpful}, p_impactful ${judgement.pImpactful}, ${result.seconds}s, $${judgement.costUsd.toFixed(2)}`);
    } catch (err) {
      failures++;
      console.error(`${note.draftId} failed: ${(err as Error).message}`);
    }
    return judgeNext();
  };
  await Promise.all(Array.from({ length: parallel }, judgeNext));
  // A failed note is left out of the results file, so running again retries it.
  if (failures > 0) throw new Error(`${failures} judges failed. Run the same command again to retry them.`);
}

await main();
