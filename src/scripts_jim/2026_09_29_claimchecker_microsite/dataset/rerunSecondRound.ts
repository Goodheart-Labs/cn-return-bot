/**
 * Takes a saved checker run and plays every check that had a second research round again, from the
 * first rejection on. The research and the first note are not made again: the saved findings, the
 * first note and its sources are used. The source verifier checks that first note again, and when it
 * rejects it again, the second round runs as the code has it now. A first note that the verifier
 * accepts this time ends the check as a note, with no second round. Every other sample is copied over.
 *
 *   With --only <row ids> only those rows are run, and the saved run holds only them.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/rerunSecondRound.ts --run 2026-10-20-0735 --label "..."
 */
import "dotenv/config";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import PQueue from "p-queue";
import { spyOn } from "bun:test";
import * as noteEvaluationFilter from "../../../pipeline/score/noteEvaluationFilter";
import { buildWriterUserMessage } from "../../../pipeline/prompts/simple-bot/writer";
import type { WriterStageResult } from "../../../pipeline/replay/writerCache";
import { closeBrowser } from "../../../pipeline/utils/browserManager";
import { LAB_DIR } from "../runStore";
import { buildEvalSetsPage } from "./buildArtifact";
import { checkSample, rowVerdictOf } from "./checkerEval";
import { isCheckable, type CheckableRow, type CheckerSample, type EvalRun } from "./evalTypes";

const RESULTS_DIR = join(LAB_DIR, "dataset", "evalRuns");
const CHECK_CONCURRENCY = 6;

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

type WriterDone = Extract<WriterStageResult, { kind: "writer_done" }>;

/** The state of a check at its first source check, from what the sample kept. Null when the sample had no second round or lacks something. */
function writerDoneOf(sample: CheckerSample): WriterDone | null {
  const round = sample.secondRound;
  if (!round?.first.sources) return null;
  const quick = sample.cascade?.decision === "note";
  const userMessage = quick ? sample.cascade?.userMessage : sample.prompts?.research;
  if (!userMessage) return null;
  const findings = round.first.findings;
  const sent = buildWriterUserMessage(userMessage, findings);
  const writerMessage = sample.prompts?.writer ?? "";
  const timingContext = writerMessage.startsWith(sent) && writerMessage.length > sent.length ? writerMessage.slice(sent.length) : undefined;
  // The answer the researcher gave, rebuilt from what the sample kept, so that the second round continues its conversation.
  const answer = JSON.stringify(quick ? { findings, misleading_probability: sample.cascade?.probability } : sample.strongProbability != null ? { findings, misleading_probability: sample.strongProbability } : { findings, misleading: true });
  return { kind: "writer_done", userMessage, findings, answer, queries: [], noteText: round.first.note, sources: round.first.sources, snippets: [], researchedBy: quick ? "quick" : "full", timingContext };
}

async function main() {
  if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  process.env.WRITER_CACHE = mkdtempSync(join(tmpdir(), "second-round-rerun-"));
  const sourceId = arg("run");
  const label = arg("label");
  if (!sourceId || !label) throw new Error('Give --run <run id> and --label "what changed"');
  const source: EvalRun = JSON.parse(readFileSync(join(RESULTS_DIR, `${sourceId}.json`), "utf8"));
  if (!source.checker) throw new Error("The run has no checker results");
  const datapoints: CheckableRow[] = JSON.parse(readFileSync(join(LAB_DIR, "dataset", "dataset.json"), "utf8")).datapoints.filter(isCheckable);
  const runId = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const picks = { search_cascade: "cascading", cascade_threshold: "0.9", jina_fetch: "on", second_round: "on" };
  const queue = new PQueue({ concurrency: CHECK_CONCURRENCY });
  const evaluation = spyOn(noteEvaluationFilter, "getEvaluationScore").mockResolvedValue({});
  let rerun = 0;
  const only = arg("only")?.split(",");
  const selectedRows = source.checker.rows.filter((row) => !only || only.includes(row.id));
  const rows = await Promise.all(
    selectedRows.map(async (row) => {
      const datapoint = datapoints.find((d) => d.id === row.id)!;
      const index = datapoints.indexOf(datapoint);
      const samples = await Promise.all(
        row.samples.map(async (sample, number) => {
          const stage = writerDoneOf(sample);
          if (!stage) return sample;
          rerun++;
          const again = (await queue.add(() => checkSample(datapoint, row.referenceNotes, runId, index, number, picks, stage))) as CheckerSample;
          // The research and the first note stay as they were, because they did not run again.
          return {
            ...sample,
            outcome: again.outcome,
            verdict: again.verdict,
            quality: again.quality,
            sourceChecks: again.sourceChecks,
            sourceVerdict: again.sourceVerdict,
            secondRound: again.secondRound,
            draftNote: stage.noteText,
            draftSources: stage.sources,
            logFiles: [...(sample.logFiles ?? []), ...(again.logFiles ?? [])],
            checkCostUsd: sample.checkCostUsd + again.checkCostUsd,
            judgeCostUsd: sample.judgeCostUsd + again.judgeCostUsd,
          };
        }),
      );
      const { passedIn, verdict } = rowVerdictOf(samples.map((s) => s.verdict));
      console.log(`${row.id}: ${verdict}, ${passedIn} of ${samples.length} (was ${row.verdict}, ${row.passedIn})`);
      return { ...row, samples, passedIn, verdict };
    }),
  );
  evaluation.mockRestore();
  const all = rows.flatMap((r) => r.samples);
  const run: EvalRun = { ...source, id: runId, label, createdAt: new Date().toISOString(), rowIds: rows.map((r) => r.id), checker: { ...source.checker, rows, costUsd: { checks: all.reduce((s, x) => s + x.checkCostUsd, 0), judge: all.reduce((s, x) => s + x.judgeCostUsd, 0) } } };
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${runId}.json`), JSON.stringify(run, null, 1));
  console.log(`Saved evalRuns/${runId}.json. ${rerun} checks were played again from the first rejection on.`);
  console.log(buildEvalSetsPage());
}

await main();
await closeBrowser();
