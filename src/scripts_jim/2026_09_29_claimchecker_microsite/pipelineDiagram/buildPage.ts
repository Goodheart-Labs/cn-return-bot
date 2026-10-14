/**
 * Writes page.html, the pipeline diagram, from template.html, prompts.json and
 * the newest eval run. The real examples in the diagram are the Berkeley claim
 * as that run extracted and checked it. Run collectPrompts.ts first, and run
 * the evals at least once. The page is published as an artifact.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/pipelineDiagram/buildPage.ts [run file]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { DatasetRow, EvalRun } from "../dataset/evalTypes";
import { LAB_DIR } from "../runStore";

const EXAMPLE_ROW = "berkeley-as";
type Example = [string, string][];

const dataset: { datapoints: DatasetRow[] } = JSON.parse(readFileSync(join(LAB_DIR, "dataset", "dataset.json"), "utf8"));
const row = dataset.datapoints.find((r) => r.id === EXAMPLE_ROW)!;
const runsDir = join(LAB_DIR, "dataset", "evalRuns");
const runFiles = existsSync(runsDir) ? readdirSync(runsDir).filter((f) => f.endsWith(".json")).sort() : [];
// An eval run file can be named on the command line. Otherwise the newest run is used.
const runPath = process.argv[2] ?? (runFiles.length ? join(runsDir, runFiles.at(-1)!) : null);
const run: EvalRun | null = runPath ? JSON.parse(readFileSync(runPath, "utf8")) : null;

function extractionExample(): Example | null {
  const result = run?.extractor?.rows.find((r) => r.id === EXAMPLE_ROW);
  const chunk = run?.extractor?.chunkRuns.find((c) => c.key === result?.chunkKey);
  if (!result || !chunk) return null;
  const sample = chunk.samples[0]!;
  const matching = result.judgements[0]?.matchingClaims.map((n) => `${n}. ${sample.claims[n - 1]?.claim}`).join("\n") ?? "";
  return [
    ["The claim of the Berkeley row, as the first sample extracted it", matching || "(the judge found no matching claim)"],
    [`All ${sample.claims.length} claims this sample found in the chunk`, sample.claims.map((c, i) => `${i + 1}. ${c.claim}`).join("\n")],
  ];
}

const checked = run?.checker?.rows.find((r) => r.id === EXAMPLE_ROW)?.samples[0];
const example = {
  extraction: extractionExample(),
  post: [["The post built for the Berkeley claim", row.checker!.post.text] as [string, string]],
  research: checked?.research ? ([["The findings of the Berkeley check", checked.research]] as Example) : null,
  writer: checked?.draftNote ? ([["The note the writer drafted for the Berkeley claim", checked.draftNote]] as Example) : null,
  verifier: checked
    ? ([
        ["The source check verdict", checked.sourceVerdict ?? "(none)"],
        ...(checked.outcome.type === "note" ? ([["The note that was accepted, with its sources", `${checked.outcome.note}\n\n${checked.outcome.sources.map((s) => s.url).join("\n")}`]] as Example) : []),
      ] as Example)
    : null,
};

const prompts = JSON.parse(readFileSync(join(LAB_DIR, "pipelineDiagram", "prompts.json"), "utf8"));
const data = JSON.stringify({ prompts, example, run: run ? { id: run.id, label: run.label } : null }).replaceAll("</", "<\\/");
const template = readFileSync(join(LAB_DIR, "pipelineDiagram", "template.html"), "utf8");
writeFileSync(join(LAB_DIR, "pipelineDiagram", "page.html"), template.replace("/*DATA*/", () => data));
console.log(`Wrote page.html${run ? ` with the examples of run ${run.id}` : " without examples, because no eval run exists yet"}`);
