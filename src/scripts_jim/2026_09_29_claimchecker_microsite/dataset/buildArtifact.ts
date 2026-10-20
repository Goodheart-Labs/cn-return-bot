/**
 * Writes the HTML of the eval sets page: the template with dataset.json inlined. Every saved run is
 * written to its own file in artifact/logs/runs, with an index.json that lists the ids newest first,
 * because all the runs together are bigger than the 16 MB an artifact page may have. The page loads
 * them when it opens. The page is published as an artifact. Run buildDataset.ts first. runEvals.ts calls this
 * after every run, so the page on disk always holds every saved run.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/buildArtifact.ts
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { LAB_DIR } from "../runStore";

const DATASET_DIR = join(LAB_DIR, "dataset");

export function buildEvalSetsPage(): string {
  const template = readFileSync(join(DATASET_DIR, "artifact", "template.html"), "utf8");
  const dataset = readFileSync(join(DATASET_DIR, "dataset.json"), "utf8");
  // "</" inside the JSON would end the script element early.
  const safeJson = dataset.replaceAll("</", "<\\/");
  const resultsDir = join(DATASET_DIR, "evalRuns");
  const runs = existsSync(resultsDir)
    ? readdirSync(resultsDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => JSON.parse(readFileSync(join(resultsDir, name), "utf8")))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const runsDir = join(DATASET_DIR, "artifact", "logs", "runs");
  mkdirSync(runsDir, { recursive: true });
  for (const run of runs) writeFileSync(join(runsDir, `${run.id}.json`), JSON.stringify(run));
  writeFileSync(join(runsDir, "index.json"), JSON.stringify(runs.map((run) => run.id)));
  const path = join(DATASET_DIR, "artifact", "evalSets.html");
  writeFileSync(path, template.replace("/*DATA*/", () => safeJson));
  return `Wrote evalSets.html with ${JSON.parse(dataset).datapoints.length} datapoints and ${runs.length} runs`;
}

if (import.meta.main) console.log(buildEvalSetsPage());
