/**
 * Takes a saved checker run and runs again every check in which the large model did the research.
 * Every other sample is copied over unchanged. The result is saved as a new run.
 * The cheap research runs again too, so a rerun check can end up on a different path than before.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/rerunStrong.ts --run 2026-10-19-1145 --label "..."
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import PQueue from "p-queue";
import { spyOn } from "bun:test";
import * as noteEvaluationFilter from "../../../pipeline/score/noteEvaluationFilter";
import { closeBrowser } from "../../../pipeline/utils/browserManager";
import { LAB_DIR } from "../runStore";
import { buildEvalSetsPage } from "./buildArtifact";
import { checkSample, rowVerdictOf } from "./checkerEval";
import { isCheckable, type CheckableRow, type CheckerSample, type EvalRun } from "./evalTypes";

const RESULTS_DIR = join(LAB_DIR, "dataset", "evalRuns");
const CHECK_CONCURRENCY = 6;
const LARGE_MODEL_DECISIONS = ["escalate", "audit"];

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const researchedByLargeModel = (sample: CheckerSample) => !!sample.cascade && LARGE_MODEL_DECISIONS.includes(sample.cascade.decision);

async function main() {
  if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  const sourceId = arg("run");
  const label = arg("label");
  if (!sourceId || !label) throw new Error('Give --run <run id> and --label "what changed"');
  const source: EvalRun = JSON.parse(readFileSync(join(RESULTS_DIR, `${sourceId}.json`), "utf8"));
  if (!source.checker) throw new Error("The run has no checker results");
  const datapoints: CheckableRow[] = JSON.parse(readFileSync(join(LAB_DIR, "dataset", "dataset.json"), "utf8")).datapoints.filter(isCheckable);
  const runId = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const picks = { search_cascade: "cascading", cascade_audit: "none", jina_fetch: "on", second_round: "on" };
  const queue = new PQueue({ concurrency: CHECK_CONCURRENCY });
  const evaluation = spyOn(noteEvaluationFilter, "getEvaluationScore").mockResolvedValue({});
  let rerun = 0;
  const rows = await Promise.all(
    source.checker.rows.map(async (row) => {
      const datapoint = datapoints.find((d) => d.id === row.id)!;
      const index = datapoints.indexOf(datapoint);
      const samples = await Promise.all(
        row.samples.map((sample, number) => {
          if (!researchedByLargeModel(sample)) return sample;
          rerun++;
          return queue.add(() => checkSample(datapoint, row.referenceNotes, runId, index, number, picks)) as Promise<CheckerSample>;
        }),
      );
      const { passedIn, verdict } = rowVerdictOf(samples.map((s) => s.verdict));
      console.log(`${row.id}: ${verdict}, ${passedIn} of ${samples.length} (was ${row.verdict}, ${row.passedIn})`);
      return { ...row, samples, passedIn, verdict };
    }),
  );
  evaluation.mockRestore();
  const rerunCost = rows.flatMap((r) => r.samples).filter((s) => s.cascade && LARGE_MODEL_DECISIONS.includes(s.cascade.decision));
  const run: EvalRun = {
    ...source,
    id: runId,
    label,
    createdAt: new Date().toISOString(),
    checker: { ...source.checker, rows, costUsd: { checks: rows.flatMap((r) => r.samples).reduce((s, x) => s + x.checkCostUsd, 0), judge: rows.flatMap((r) => r.samples).reduce((s, x) => s + x.judgeCostUsd, 0) } },
  };
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${runId}.json`), JSON.stringify(run, null, 1));
  console.log(`Saved evalRuns/${runId}.json. ${rerun} checks were rerun, ${rerunCost.length} of the saved samples are on the large-model path now.`);
  console.log(buildEvalSetsPage());
}

await main();
await closeBrowser();
