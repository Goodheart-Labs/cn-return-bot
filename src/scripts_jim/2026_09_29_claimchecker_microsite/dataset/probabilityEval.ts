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
import { SEARCH_SYSTEM_PROMPT_CLAIM_PROBABILITY as PROBABILITY_SYSTEM_PROMPT, SEARCH_SYSTEM_PROMPT_PROBABILITY as X_PROBABILITY_SYSTEM_PROMPT } from "../../../pipeline/prompts/simple-bot/searchAgent";
import { extractJsonObject } from "../../../pipeline/utils/jsonOutput";
import { addTokenCost, emptyTokenCost, extractOpenRouterCost } from "../../../pipeline/cost-tracking/pricing";
import { createBotInput } from "../../../pipeline/input/createBotInput";
import { buildUserMessage, buildUserMessageFromInput } from "../../../pipeline/prompts/input/userMessage";
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

/** The same picks, without the Common Notes pipeline, so that a tweet is read as the X bot reads it. */
const { commonnotes_pipeline: _commonNotesOnly, ...X_FORCED_PICKS } = FORCED_PICKS;

interface ProbabilityOutput {
  findings: string;
  misleading_probability: number;
}

async function askOnce(systemPrompt: string, userMessage: string): Promise<ProbabilitySample> {
  const cost = emptyTokenCost();
  const response = await llm.create({
    model: "openai/gpt-6-luna",
    tools: [OPENROUTER_NATIVE_WEB_SEARCH_TOOL],
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  } as any);
  addTokenCost(cost, extractOpenRouterCost(response));
  const output = JSON.parse(extractJsonObject(response.choices?.[0]?.message?.content ?? "")) as ProbabilityOutput;
  if (typeof output.misleading_probability !== "number") throw new Error("The answer has no misleading_probability");
  return { probability: output.misleading_probability, userMessage, findings: output.findings, costUsd: cost.cost ?? 0 };
}

async function sampleRow(row: CheckableRow, runId: string, index: number, sample: number): Promise<ProbabilitySample> {
  try {
    const id = `eval-${runId}-p${index}-${sample}`;
    const { config } = withForcedPicks(row.xPost ? X_FORCED_PICKS : FORCED_PICKS, () => runABTests(AB_TESTS));
    const log = createTweetLog();
    return await withTweetLog(log, () =>
      withBotConfig(config, () =>
        withCostTracker(async () => {
          // A tweet keeps its real id, because the X bot's message names the tweet. A claim gets a synthetic id.
          const post = (row.xPost ? row.checker.post : { ...row.checker.post, id }) as Parameters<typeof createBotInput>[0];
          const userMessage = row.xPost ? buildUserMessage({ post, tweetMedia: [], quotedTweetMedia: [] }) : buildUserMessageFromInput(post, await createBotInput(post, "probability-eval"));
          return askOnce(row.xPost ? X_PROBABILITY_SYSTEM_PROMPT : PROBABILITY_SYSTEM_PROMPT, userMessage);
        }),
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
  return { samples: SAMPLES_PER_ROW, prompt: PROBABILITY_SYSTEM_PROMPT, xPrompt: X_PROBABILITY_SYSTEM_PROMPT, rows: results, costUsd: results.flatMap((r) => r.samples).reduce((s, x) => s + x.costUsd, 0) };
}
