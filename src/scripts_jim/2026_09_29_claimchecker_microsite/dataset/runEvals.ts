/**
 * Runs the extractor eval, the checker eval or both on all datapoints or a
 * chosen few, and saves the result as evalRuns/<run id>.json. It calls the same
 * functions the production services call, in this process, and writes nothing
 * to the production database.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/runEvals.ts --label "baseline"
 *       [--eval extractor|checker|probability|both] [--search-cascade precheck|cascading] [--jina-fetch on|off] [--second-round on|off] [--only id,id,...] [--group note-easy|...]
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
import { GROUP_TITLE } from "./datapoints";
import { runCheckerEval } from "./checkerEval";
import { isCheckable, isExtractable, isUnlabelled, type DatasetRow, type EvalName, type EvalRun } from "./evalTypes";
import { buildEvalSetsPage } from "./buildArtifact";
import { runProbabilityEval } from "./probabilityEval";
import { runExtractorEval } from "./extractorEval";
import { OTHER_TYPE } from "../../../everything/pipeline/passages";
import { PASSAGE_TYPE_DESCRIPTIONS } from "../../../everything/pipeline/extractClaims";

const RESULTS_DIR = join(LAB_DIR, "dataset", "evalRuns");

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function selectedRows(all: DatasetRow[]): DatasetRow[] {
  const only = arg("only")?.split(",");
  const groups = arg("group")?.split(",");
  const unknownGroup = (groups ?? []).find((g) => !(g in GROUP_TITLE));
  if (unknownGroup) throw new Error(`Unknown group "${unknownGroup}". Groups are ${Object.keys(GROUP_TITLE).join(", ")}`);
  const unknown = (only ?? []).filter((id) => !all.some((r) => r.id === id));
  if (unknown.length) throw new Error(`Unknown row ids: ${unknown.join(", ")}`);
  return all.filter((r) => (!only || only.includes(r.id)) && (!groups || groups.includes(r.group)));
}

const PERSONAL_STORIES_EXAMPLE = "e.g. parts of personal stories";

/** Other wordings of the example in the description of "other". The default is the production wording, which has the example without brackets. */
function extractionOptionsOf(variant: string | undefined) {
  const other = PASSAGE_TYPE_DESCRIPTIONS[OTHER_TYPE];
  if (!variant) return {};
  const wordings: Record<string, string> = {
    "bracket-example": other.replace(PERSONAL_STORIES_EXAMPLE, `(${PERSONAL_STORIES_EXAMPLE})`),
    "no-example": other.replace(` ${PERSONAL_STORIES_EXAMPLE}`, ""),
  };
  if (!(variant in wordings)) throw new Error(`Unknown --other-variant "${variant}". Variants are ${Object.keys(wordings).join(", ")}`);
  return { extraTypes: { [OTHER_TYPE]: wordings[variant]! } };
}

function currentCommit(): string {
  const commit = execSync("git rev-parse --short HEAD").toString().trim();
  const dirty = execSync("git status --porcelain -- src/everything src/pipeline").toString().trim() !== "";
  return dirty ? `${commit} with uncommitted changes` : commit;
}

async function main() {
  // The local OPENROUTER_API_KEY is dead. The testing key works.
  if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  // The cascade is live on 60% of traffic, so an eval must choose its arm. The default is the search step as it was before. The audit arm, which sends claims the cheap step wants to drop to the stronger model anyway, is never part of an eval.
  const searchCascade = arg("search-cascade") ?? "precheck";
  const label = arg("label");
  if (!label) throw new Error('Give the run a label: --label "what changed"');
  const evals: EvalName[] = (arg("eval") ?? "both") === "both" ? ["extractor", "checker"] : [arg("eval") as EvalName];
  const rows = selectedRows(JSON.parse(readFileSync(join(LAB_DIR, "dataset", "dataset.json"), "utf8")).datapoints);
  if (rows.length === 0) throw new Error("No rows selected");
  const runId = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  console.log(`Run ${runId} "${label}": ${evals.join(" and ")} on ${rows.length} rows`);

  // The two evals do not depend on each other, so they run side by side.
  const [extractor, checker, probability] = await Promise.all([
    evals.includes("extractor") ? runExtractorEval(rows.filter(isExtractable), rows.filter(isUnlabelled), extractionOptionsOf(arg("other-variant"))) : null,
    evals.includes("checker") ? runCheckerEval(rows.filter(isCheckable), runId, { search_cascade: searchCascade, cascade_audit: "none", ...(arg("jina-fetch") ? { jina_fetch: arg("jina-fetch")! } : {}), ...(arg("second-round") ? { second_round: arg("second-round")! } : {}) }) : null,
    evals.includes("probability") ? runProbabilityEval(rows.filter(isCheckable), runId) : null,
  ]);

  const run: EvalRun = {
    id: runId,
    label,
    createdAt: new Date().toISOString(),
    commit: currentCommit(),
    settings: {
      extractorModel: extractionModels().model,
      checkerModels: `the pipeline's forced picks, search step: ${searchCascade}`,
      commentsFetched: !!process.env.XAI_API_KEY,
      samples: { extractor: extractor?.samples ?? 0, checker: checker?.samples ?? 0 },
    },
    rowIds: rows.map((r) => r.id),
    extractor,
    checker,
    probability,
  };
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${runId}.json`), JSON.stringify(run, null, 1));
  const total = (extractor ? extractor.costUsd.extraction + extractor.costUsd.judge : 0) + (checker ? checker.costUsd.checks + checker.costUsd.judge : 0) + (probability?.costUsd ?? 0);
  console.log(`Saved evalRuns/${runId}.json, $${total.toFixed(2)} in total`);
  console.log(buildEvalSetsPage());
}

await main();
await closeBrowser();
