/**
 * Takes a saved checker run and runs the writer and every step after it again on the findings that
 * the research step gave. The research is not run again. A sample that ended before the writer
 * (the research said no note) is copied over unchanged.
 *
 * The findings of a sample are the cheap model's when it went straight to the writer, and otherwise
 * the stronger model's. When the sample had a second round, the findings from before the round are used.
 * The date block that the writer was given is read from the writer message that was saved.
 *
 *   With --only <row ids> only those rows are run, and the saved run holds only them.
 *   With --writer <variant> the writer is the model of that arm of the simple_bot_writer test.
 *   With --no-source-check the source verifier is not called: the note is accepted with every source it cites.
 *   With --findings-from <run id> the findings before a second round are read from that run, for a run that has no second rounds.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/rerunWriter.ts --run 2026-10-20-0348 --label "..."
 */
import "dotenv/config";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import PQueue from "p-queue";
import { spyOn } from "bun:test";
import * as noteEvaluationFilter from "../../../pipeline/score/noteEvaluationFilter";
import * as sourceVerifier from "../../../pipeline/verify/sourceVerifier";
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

type Researched = Extract<WriterStageResult, { kind: "researched" }>;

/** What the research step handed to the writer in a saved sample, or null when the sample never reached the writer. */
function researchedOf(sample: CheckerSample, findingsBeforeSecondRound?: string): Researched | null {
  if (sample.draftNote === null) return null;
  const quick = sample.cascade?.decision === "note";
  const findings = findingsBeforeSecondRound ?? sample.secondRound?.first.findings ?? (quick ? sample.cascade?.findings : sample.research);
  const userMessage = quick ? sample.cascade?.userMessage : sample.prompts?.research;
  if (!findings || !userMessage) return null;
  const sent = buildWriterUserMessage(userMessage, findings);
  const writerMessage = sample.prompts?.writer ?? "";
  const timingContext = writerMessage.startsWith(sent) && writerMessage.length > sent.length ? writerMessage.slice(sent.length) : undefined;
  // The answer the researcher gave, rebuilt from what the sample kept, so that a second round can continue its conversation.
  const answer = JSON.stringify(quick ? { findings, misleading_probability: sample.cascade?.probability } : sample.strongProbability != null ? { findings, misleading_probability: sample.strongProbability } : { findings, misleading: true });
  return { kind: "researched", userMessage, findings, answer, researchedBy: quick ? "quick" : "full", timingContext };
}

async function main() {
  if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  process.env.WRITER_CACHE = mkdtempSync(join(tmpdir(), "writer-rerun-"));
  const sourceId = arg("run");
  const label = arg("label");
  if (!sourceId || !label) throw new Error('Give --run <run id> and --label "what changed"');
  const source: EvalRun = JSON.parse(readFileSync(join(RESULTS_DIR, `${sourceId}.json`), "utf8"));
  if (!source.checker) throw new Error("The run has no checker results");
  const datapoints: CheckableRow[] = JSON.parse(readFileSync(join(LAB_DIR, "dataset", "dataset.json"), "utf8")).datapoints.filter(isCheckable);
  const runId = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const writer = arg("writer");
  const picks: Record<string, string> = { search_cascade: "cascading", cascade_audit: "none", jina_fetch: "on", second_round: "on", ...(writer ? { simple_bot_writer: writer } : {}) };
  const findingsSource: EvalRun | undefined = arg("findings-from") ? JSON.parse(readFileSync(join(RESULTS_DIR, `${arg("findings-from")}.json`), "utf8")) : undefined;
  const acceptedWithoutCheck = process.argv.includes("--no-source-check")
    ? spyOn(sourceVerifier, "verifySources").mockImplementation(async (params) => ({ reasoning: "The source check was switched off.", good_sources: params.sources, bad_sources: [], accepted: true }))
    : undefined;
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
          const earlier = findingsSource?.checker?.rows.find((r) => r.id === row.id)?.samples[number];
          const researched = researchedOf(sample, earlier?.secondRound?.first.findings);
          if (!researched) return sample;
          rerun++;
          const again = (await queue.add(() => checkSample(datapoint, row.referenceNotes, runId, index, number, picks, researched))) as CheckerSample;
          // The research part of the sample stays as it was, because it did not run again.
          return { ...sample, outcome: again.outcome, verdict: again.verdict, quality: again.quality, draftNote: again.draftNote, draftSources: again.draftSources, sourceChecks: again.sourceChecks, sourceVerdict: again.sourceVerdict, secondRound: again.secondRound, prompts: { research: sample.prompts?.research ?? null, writer: again.prompts?.writer ?? null }, models: sample.models && again.models ? { ...sample.models, writer: again.models.writer, verifier: again.models.verifier } : sample.models, logFiles: [...(sample.logFiles ?? []), ...(again.logFiles ?? [])], checkCostUsd: sample.checkCostUsd + again.checkCostUsd, judgeCostUsd: sample.judgeCostUsd + again.judgeCostUsd };
        }),
      );
      const { passedIn, verdict } = rowVerdictOf(samples.map((s) => s.verdict));
      console.log(`${row.id}: ${verdict}, ${passedIn} of ${samples.length} (was ${row.verdict}, ${row.passedIn})`);
      return { ...row, samples, passedIn, verdict };
    }),
  );
  evaluation.mockRestore();
  acceptedWithoutCheck?.mockRestore();
  const all = rows.flatMap((r) => r.samples);
  const run: EvalRun = { ...source, id: runId, label, createdAt: new Date().toISOString(), rowIds: rows.map((r) => r.id), checker: { ...source.checker, rows, costUsd: { checks: all.reduce((s, x) => s + x.checkCostUsd, 0), judge: all.reduce((s, x) => s + x.judgeCostUsd, 0) } } };
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${runId}.json`), JSON.stringify(run, null, 1));
  console.log(`Saved evalRuns/${runId}.json. ${rerun} checks were run again from the writer on.`);
  console.log(buildEvalSetsPage());
}

await main();
await closeBrowser();
