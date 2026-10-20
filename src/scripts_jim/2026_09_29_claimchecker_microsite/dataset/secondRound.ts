/**
 * Simulates a second round for checks that the source verifier rejected.
 *
 * In the real pipeline the verifier's verdict ends the check. Here the research
 * step is told what the verifier said and writes revised findings. The writer
 * then writes a note from them, and the verifier checks it again. Each case is
 * run several times, and the script reports whether the second verifier accepts.
 *
 * A case is "<row id>.<sample number>" of an eval run whose logs were saved in
 * logs/eval-<run id>/. The research input, the findings that went to the writer,
 * the note and the verifier's verdict are read from that log.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/secondRound.ts --run 2026-10-19-0744 --cases berkeley-as.1,x-01.1 [--samples 3] [--label "..."]
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import PQueue from "p-queue";
import { runABTests, withForcedPicks } from "../../../pipeline/ab-testing/abTests";
import { AB_TESTS } from "../../../pipeline/ab-testing/abTestsData";
import { withBotConfig } from "../../../pipeline/ab-testing/botConfig";
import { withCostTracker, getCostTracker } from "../../../pipeline/cost-tracking/costTracker";
import { addTokenCost, emptyTokenCost, extractOpenRouterCost } from "../../../pipeline/cost-tracking/pricing";
import { llm } from "../../../pipeline/llm/llm";
import { SEARCH_SYSTEM_PROMPT_CLAIM, SEARCH_SYSTEM_PROMPT_CLAIM_PROBABILITY, SEARCH_SYSTEM_PROMPT, SEARCH_SYSTEM_PROMPT_PROBABILITY } from "../../../pipeline/prompts/simple-bot/searchAgent";
import { CASCADE_COMMONNOTES_STRONG_MODEL, CASCADE_WEAK_MODEL } from "../../../pipeline/simple-bot/cascadeSearch";
import { appendUrlCitations } from "../../../pipeline/simple-bot/searchDispatch";
import { runWriter } from "../../../pipeline/simple-bot/writer";
import { OPENROUTER_NATIVE_WEB_SEARCH_TOOL, WEB_SEARCH_TOOL, stripBrowserLineCitations } from "../../../pipeline/tool-calling/tools";
import { extractJsonObject } from "../../../pipeline/utils/jsonOutput";
import { createTweetLog, withTweetLog } from "../../../pipeline/utils/tweetLog";
import { verifySources } from "../../../pipeline/verify/sourceVerifier";
import { LAB_DIR } from "../runStore";

const SAMPLES_DEFAULT = 3;
const CONCURRENCY = 4;
const REASONING_EFFORT = "medium";
/** Below this probability the quick research would have ended the check, so a revision that says so ends the second round too. */
const WEAK_NO_NOTE_BELOW = 0.3;

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

type SecondRoundOutcome = "accepted" | "rejected" | "writer_empty" | "research_withdrew" | "unfetchable" | "error";

interface SecondRoundSample {
  outcome: SecondRoundOutcome;
  reasoning: string | null;
  note: string | null;
  revisedFindings: string | null;
  costUsd: number;
}

interface CaseInput {
  id: string;
  picks: Record<string, string>;
  /** True when the findings came from the quick research, whose answer is a probability. */
  weak: boolean;
  researchModel: string;
  isClaim: boolean;
  userMessage: string;
  previousAnswer: string;
  note: string;
  noteSources: string[];
  verifierAnswer: unknown;
  verifierReasoning: string;
}

function readCase(runId: string, id: string): CaseInput {
  const [rowId, sample] = id.split(".");
  const log = JSON.parse(readFileSync(join(LAB_DIR, "logs", `eval-${runId}`, `${rowId}.${sample}.json`), "utf8"));
  const steps = log.logs.note_writer_steps;
  const cascade = log.logs.cascade;
  const picks = log.abTestPicks as Record<string, string>;
  const isClaim = picks.commonnotes_pipeline === "on";
  const escalated = !cascade || cascade.decision === "escalate" || cascade.decision === "audit";
  const weak = !!cascade && !escalated;
  const search = steps.search?.messages;
  const quick = steps.weak_search?.messages;
  const researchInput = (escalated ? search : quick)["0"];
  const researchAnswer = (escalated ? search : quick)["1"].content;
  const writerAttempts = steps.note_writer.attempts;
  const lastAttempt = writerAttempts[Object.keys(writerAttempts).sort().at(-1)!];
  const verification = steps.source_verifier.turn["1"].messages["1"].content;
  const strongModel = isClaim ? CASCADE_COMMONNOTES_STRONG_MODEL : "anthropic/claude-sonnet-5";
  return {
    id,
    picks,
    weak,
    researchModel: weak ? CASCADE_WEAK_MODEL : strongModel,
    isClaim,
    userMessage: researchInput.userMessage,
    previousAnswer: JSON.stringify(researchAnswer),
    note: lastAttempt.response.note_text,
    noteSources: lastAttempt.response.sources ?? [],
    verifierAnswer: { accepted: verification.accepted, reasoning: verification.reasoning, sources: verification.source_evaluations },
    verifierReasoning: verification.reasoning,
  };
}

function systemPromptOf(input: CaseInput): string {
  if (input.weak) return input.isClaim ? SEARCH_SYSTEM_PROMPT_CLAIM_PROBABILITY : SEARCH_SYSTEM_PROMPT_PROBABILITY;
  return input.isClaim ? SEARCH_SYSTEM_PROMPT_CLAIM : SEARCH_SYSTEM_PROMPT;
}

/** What the research step is told in the second round: the note that was written from its findings and everything the verifier said about it. */
function feedbackMessage(input: CaseInput): string {
  return `A source checker opened the pages you cited and rejected the note that was written from your findings. Its full answer is below.

Write revised research findings, as the same JSON object as before. Keep what the checker confirmed. Remove or reword every claim that no fetched page supports. For a page that could not be fetched, find another page that says the same thing and can be opened, and cite that instead. Cite only pages whose text states what you rely on.

## The note that was written from your findings
${input.note}

## The source checker's answer
${JSON.stringify(input.verifierAnswer, null, 1)}`;
}

/** Asks the same research model again, with the first answer and the verifier's feedback in the conversation. */
async function reviseResearch(input: CaseInput): Promise<{ findings: string; withdrew: boolean }> {
  const cost = emptyTokenCost();
  const strong = !input.weak;
  const response = await llm.create({
    model: input.researchModel,
    tools: [strong ? WEB_SEARCH_TOOL : OPENROUTER_NATIVE_WEB_SEARCH_TOOL],
    reasoning_effort: REASONING_EFFORT,
    messages: [
      { role: "system", content: strong ? `${systemPromptOf(input)}\n\nRespond with strict JSON only matching: { findings: string, correction_needed: boolean }` : systemPromptOf(input) },
      { role: "user", content: input.userMessage },
      { role: "assistant", content: input.previousAnswer },
      { role: "user", content: feedbackMessage(input) },
    ],
  } as any);
  addTokenCost(cost, extractOpenRouterCost(response));
  const message = response.choices?.[0]?.message;
  const answer = JSON.parse(extractJsonObject(message?.content ?? ""));
  if (typeof answer.findings !== "string") throw new Error("The revised answer has no findings");
  const findings = appendUrlCitations(stripBrowserLineCitations(answer.findings), message?.annotations);
  const withdrew = strong ? answer.correction_needed === false : typeof answer.misleading_probability === "number" && answer.misleading_probability < WEAK_NO_NOTE_BELOW;
  return { findings, withdrew };
}

async function runSample(input: CaseInput): Promise<SecondRoundSample> {
  const empty = { reasoning: null, note: null, revisedFindings: null, costUsd: 0 };
  try {
    const { config } = withForcedPicks(input.picks, () => runABTests(AB_TESTS));
    return await withTweetLog(createTweetLog(), () =>
      withBotConfig(config, () =>
        withCostTracker(async () => {
          const costUsd = () => getCostTracker().reduce((sum, c) => sum + (c.cost ?? 0), 0);
          const revised = await reviseResearch(input);
          if (revised.withdrew) return { ...empty, outcome: "research_withdrew" as const, revisedFindings: revised.findings, costUsd: costUsd() };
          const note = await runWriter(input.userMessage, revised.findings);
          if (note.noteText.trim() === "") return { ...empty, outcome: "writer_empty" as const, revisedFindings: revised.findings, costUsd: costUsd() };
          try {
            const verification = await verifySources({ noteText: note.noteText, sources: note.sources, postContext: input.userMessage, researcherFindings: revised.findings, turnNumber: 1 });
            return { outcome: verification.accepted ? ("accepted" as const) : ("rejected" as const), reasoning: verification.reasoning, note: note.noteText, revisedFindings: revised.findings, costUsd: costUsd() };
          } catch (err: any) {
            if (err?.name !== "UnfetchableSourcesError") throw err;
            return { outcome: "unfetchable" as const, reasoning: err.message, note: note.noteText, revisedFindings: revised.findings, costUsd: costUsd() };
          }
        }),
      ),
    );
  } catch (err: any) {
    return { ...empty, outcome: "error", reasoning: err?.message ?? String(err) };
  }
}

async function main() {
  // The local OPENROUTER_API_KEY is dead. The testing key works.
  if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  const runId = arg("run");
  const cases = arg("cases")?.split(",");
  if (!runId || !cases) throw new Error("Give --run <eval run id> and --cases <row.sample,row.sample,...>");
  const samples = Number(arg("samples") ?? SAMPLES_DEFAULT);
  const queue = new PQueue({ concurrency: CONCURRENCY });
  const results = await Promise.all(
    cases.map(async (id) => {
      const input = readCase(runId, id);
      const outcomes = await Promise.all(Array.from({ length: samples }, () => queue.add(() => runSample(input)) as Promise<SecondRoundSample>));
      console.log(`${id}: ${outcomes.map((o) => o.outcome).join(", ")}`);
      return { id, researchModel: input.researchModel, firstVerdict: input.verifierReasoning, samples: outcomes };
    }),
  );
  const outDir = join(LAB_DIR, "dataset", "secondRounds");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "")}.json`);
  writeFileSync(file, JSON.stringify({ runId, label: arg("label") ?? null, samplesPerCase: samples, results }, null, 1));
  console.log(`Saved ${file}, $${results.flatMap((r) => r.samples).reduce((s, x) => s + x.costUsd, 0).toFixed(2)} in total`);
}

await main();
