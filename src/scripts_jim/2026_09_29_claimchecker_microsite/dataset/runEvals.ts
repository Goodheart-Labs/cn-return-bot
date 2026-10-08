/**
 * Runs the extractor eval, the checker eval or both on all datapoints or a
 * chosen few, and saves the result as evalRuns/<run id>.json. It calls the same
 * functions the production services call, in this process, and writes nothing
 * to the production database.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/runEvals.ts --label "baseline"
 *       [--eval extractor|checker|both] [--only id,id,...] [--group note-easy|...]
 *
 * The image descriptions must have been frozen first, with freezeImages.ts.
 */
import "dotenv/config";
import { execSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { closeBrowser } from "../../../pipeline/utils/browserManager";
import { extractionModels } from "../../../everything/pipeline/model";
import { LAB_DIR } from "../runStore";
import { GROUP_TITLE, type Group } from "./datapoints";
import { runCheckerEval } from "./checkerEval";
import type { DatasetRow, EvalName, EvalRun } from "./evalTypes";
import { runExtractorEval } from "./extractorEval";
import { loadFrozenDescriptions } from "./freezeImages";
import { loadItemTexts } from "./itemTexts";

const RESULTS_DIR = join(LAB_DIR, "dataset", "evalRuns");

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function selectedRows(all: DatasetRow[]): DatasetRow[] {
  const only = arg("only")?.split(",");
  const group = arg("group");
  if (group && !(group in GROUP_TITLE)) throw new Error(`Unknown group "${group}". Groups are ${Object.keys(GROUP_TITLE).join(", ")}`);
  const unknown = (only ?? []).filter((id) => !all.some((r) => r.id === id));
  if (unknown.length) throw new Error(`Unknown row ids: ${unknown.join(", ")}`);
  return all.filter((r) => (!only || only.includes(r.id)) && (!group || r.group === (group as Group)));
}

function currentCommit(): string {
  const commit = execSync("git rev-parse --short HEAD").toString().trim();
  const dirty = execSync("git status --porcelain -- src/everything src/pipeline").toString().trim() !== "";
  return dirty ? `${commit} with uncommitted changes` : commit;
}

async function main() {
  // The local OPENROUTER_API_KEY is dead. The testing key works.
  if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  const label = arg("label");
  if (!label) throw new Error('Give the run a label: --label "what changed"');
  const evals: EvalName[] = (arg("eval") ?? "both") === "both" ? ["extractor", "checker"] : [arg("eval") as EvalName];
  const rows = selectedRows(JSON.parse(readFileSync(join(LAB_DIR, "dataset", "dataset.json"), "utf8")).datapoints);
  if (rows.length === 0) throw new Error("No rows selected");
  const runId = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  console.log(`Run ${runId} "${label}": ${evals.join(" and ")} on ${rows.length} rows`);

  const extractor = evals.includes("extractor")
    ? await runExtractorEval(rows, await loadItemTexts(rows.map((r) => r.item.id)), loadFrozenDescriptions())
    : null;
  const checker = evals.includes("checker") ? await runCheckerEval(rows, runId) : null;

  const run: EvalRun = {
    id: runId,
    label,
    createdAt: new Date().toISOString(),
    commit: currentCommit(),
    settings: {
      extractorModel: extractionModels().model,
      checkerModels: "the pipeline's forced picks: Muse Spark 1.3 for search, writer and source verifier",
      commentsFetched: !!process.env.XAI_API_KEY,
      samples: extractor?.samples ?? 0,
    },
    rowIds: rows.map((r) => r.id),
    extractor,
    checker,
  };
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${runId}.json`), JSON.stringify(run, null, 1));
  const total = (extractor ? extractor.costUsd.extraction + extractor.costUsd.judge : 0) + (checker ? checker.costUsd.checks + checker.costUsd.judge : 0);
  console.log(`Saved evalRuns/${runId}.json, $${total.toFixed(2)} in total`);
}

await main();
await closeBrowser();
