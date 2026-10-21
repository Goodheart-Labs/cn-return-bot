/**
 * Works out what a saved checker run would have scored if the source check did not exist. No model is
 * called. Every check that got as far as a drafted note ends as that note, with all the sources the
 * writer cited, unless the materiality gate turned it down. The second round never happens, because it
 * only exists to answer a rejection. Checks that ended before the writer stay as they were. The quality
 * judge is not run, so the notes carry no quality verdict.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/withoutSourceCheck.ts --run 2026-10-20-0916 --label "..."
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { LAB_DIR } from "../runStore";
import { buildEvalSetsPage } from "./buildArtifact";
import { rowVerdictOf, verdictOf } from "./checkerEval";
import type { CheckerOutcome, CheckerRowResult, CheckerSample, EvalRun } from "./evalTypes";

const RESULTS_DIR = join(LAB_DIR, "dataset", "evalRuns");
const MATERIALITY_REASON = "low_materiality_score";

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

/** The sample as it would have ended without the source check. */
function withoutSourceCheck(sample: CheckerSample, expected: CheckerRowResult["expected"]): CheckerSample {
  const rejected = sample.outcome.type === "no_note" && sample.outcome.reason === "check_failed";
  const accepted = sample.outcome.type === "note";
  if (!sample.draftNote || (!rejected && !accepted)) return sample;
  const outcome: CheckerOutcome = { type: "note", note: sample.draftNote, sources: sample.draftSources ?? [] };
  return { ...sample, outcome, verdict: verdictOf(expected, outcome), quality: rejected || sample.secondRound ? null : sample.quality, secondRound: null };
}

const sourceId = arg("run");
const label = arg("label");
if (!sourceId || !label) throw new Error('Give --run <run id> and --label "what changed"');
const source: EvalRun = JSON.parse(readFileSync(join(RESULTS_DIR, `${sourceId}.json`), "utf8"));
if (!source.checker) throw new Error("The run has no checker results");
const runId = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
let changed = 0;
const rows = source.checker.rows.map((row) => {
  const samples = row.samples.map((s) => {
    const next = withoutSourceCheck(s, row.expected);
    if (next !== s && (next.outcome.type !== s.outcome.type || next.secondRound !== s.secondRound)) changed++;
    return next;
  });
  const { passedIn, verdict } = rowVerdictOf(samples.map((s) => s.verdict));
  console.log(`${row.id}: ${verdict}, ${passedIn} of ${samples.length} (was ${row.verdict}, ${row.passedIn})`);
  return { ...row, samples, passedIn, verdict };
});
const run: EvalRun = { ...source, id: runId, label, createdAt: new Date().toISOString(), checker: { ...source.checker, rows } };
mkdirSync(RESULTS_DIR, { recursive: true });
writeFileSync(join(RESULTS_DIR, `${runId}.json`), JSON.stringify(run, null, 1));
const count = (r: EvalRun, v: string) => r.checker!.rows.filter((x) => x.verdict === v).length;
console.log(`Saved evalRuns/${runId}.json. ${changed} samples changed. Passing rows: ${count(source, "pass")} -> ${count(run, "pass")}`);
console.log(buildEvalSetsPage());
