/**
 * Eval 3: how likely does the research step think the claim is misleading?
 *
 * Only the research step runs. It gets the same message as in the claim check,
 * but its JSON answer asks for a subjective probability that the claim is
 * misleading in any way, instead of the yes or no field correction_needed.
 * There is no note writer and no source verifier. Each row is asked three
 * times, and the page shows the three probabilities.
 */
import PQueue from "p-queue";
import { llm } from "../../../pipeline/llm/llm";
import { OPENROUTER_NATIVE_WEB_SEARCH_TOOL } from "../../../pipeline/tool-calling/tools";
import { SEARCH_SYSTEM_PROMPT_CLAIM } from "../../../pipeline/prompts/simple-bot/searchAgent";
import { extractJsonObject } from "../../../pipeline/utils/jsonOutput";
import { addTokenCost, emptyTokenCost, extractOpenRouterCost } from "../../../pipeline/cost-tracking/pricing";
import { createBotInput } from "../../../pipeline/input/createBotInput";
import { buildUserMessageFromInput } from "../../../pipeline/prompts/input/userMessage";
import { withBotConfig } from "../../../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../../../pipeline/cost-tracking/costTracker";
import { runABTests, withForcedPicks } from "../../../pipeline/ab-testing/abTests";
import { AB_TESTS } from "../../../pipeline/ab-testing/abTestsData";
import { createTweetLog, withTweetLog } from "../../../pipeline/utils/tweetLog";
import type { CheckableRow, ProbabilityEvalResult, ProbabilityRowResult, ProbabilitySample } from "./evalTypes";

const SAMPLES_PER_ROW = 3;
const CHECK_CONCURRENCY = 6;
/** The same picks as the claim check, so the research step sees the same input and runs on the same model. */
const FORCED_PICKS: Record<string, string> = {
  bot: "simple-bot",
  note_prefilter: "off",
  commonnotes_pipeline: "on",
  simple_bot_search: "gpt6luna-native",
  media_description: "gemini3flash",
};

const PROBABILITY_FIELD = `- misleading_probability: your subjective probability, as a number from 0 to 1, that the claim is misleading in any way.`;

function replaceOnce(text: string, pattern: RegExp, replacement: string): string {
  if (!pattern.test(text)) throw new Error(`The research prompt no longer contains ${pattern}`);
  return text.replace(pattern, replacement);
}

/** The pipeline's research prompt for a claim, with the correction_needed field swapped for the probability. */
export const PROBABILITY_SYSTEM_PROMPT = [
  replaceOnce(replaceOnce(SEARCH_SYSTEM_PROMPT_CLAIM, /- correction_needed:.*\n/, `${PROBABILITY_FIELD}\n`), /If no correction is needed/, "If the claim is not misleading"),
  `Respond with strict JSON only matching: { findings: string, misleading_probability: number }`,
].join("\n\n").replace(/\n## When NOT to set correction_needed = true[\s\S]*?(?=\n## Sourcing rules)/, "");

interface ProbabilityOutput {
  findings: string;
  misleading_probability: number;
}

async function askOnce(userMessage: string): Promise<ProbabilitySample> {
  const cost = emptyTokenCost();
  const response = await llm.create({
    model: "openai/gpt-6-luna",
    tools: [OPENROUTER_NATIVE_WEB_SEARCH_TOOL],
    messages: [
      { role: "system", content: PROBABILITY_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
  } as any);
  addTokenCost(cost, extractOpenRouterCost(response));
  const output = JSON.parse(extractJsonObject(response.choices?.[0]?.message?.content ?? "")) as ProbabilityOutput;
  if (typeof output.misleading_probability !== "number") throw new Error("The answer has no misleading_probability");
  return { probability: output.misleading_probability, findings: output.findings, costUsd: cost.cost ?? 0 };
}

async function sampleRow(row: CheckableRow, runId: string, index: number, sample: number): Promise<ProbabilitySample> {
  try {
    const post = { ...row.checker.post, id: `eval-${runId}-p${index}-${sample}` } as Parameters<typeof createBotInput>[0];
    const { config } = withForcedPicks(FORCED_PICKS, () => runABTests(AB_TESTS));
    const log = createTweetLog();
    return await withTweetLog(log, () =>
      withBotConfig(config, () =>
        withCostTracker(async () => askOnce(buildUserMessageFromInput(post, await createBotInput(post, "probability-eval")))),
      ),
    );
  } catch (err: any) {
    return { probability: null, findings: null, costUsd: 0, error: err?.message ?? String(err) };
  }
}

export async function runProbabilityEval(rows: CheckableRow[], runId: string): Promise<ProbabilityEvalResult> {
  console.log(`Probability eval: ${rows.length} rows, ${SAMPLES_PER_ROW} samples each`);
  const queue = new PQueue({ concurrency: CHECK_CONCURRENCY });
  const results: ProbabilityRowResult[] = await Promise.all(
    rows.map(async (row, index) => {
      const samples = await Promise.all(
        Array.from({ length: SAMPLES_PER_ROW }, (_, sample) => queue.add(() => sampleRow(row, runId, index, sample)) as Promise<ProbabilitySample>),
      );
      console.log(`  ${row.id}: ${samples.map((s) => s.probability ?? "error").join(", ")}`);
      return { id: row.id, group: row.group, expected: row.expected, samples };
    }),
  );
  return { samples: SAMPLES_PER_ROW, prompt: PROBABILITY_SYSTEM_PROMPT, rows: results, costUsd: results.flatMap((r) => r.samples).reduce((s, x) => s + x.costUsd, 0) };
}
