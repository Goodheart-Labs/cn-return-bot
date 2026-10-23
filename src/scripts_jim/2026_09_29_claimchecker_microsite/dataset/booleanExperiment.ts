/**
 * Runs the stronger model's research on one saved check with a yes or no question
 * instead of a probability, a few times, and prints each answer.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/booleanExperiment.ts [--probability]
 *
 * With --probability the question is the production one, a probability from 0 to 1.
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { llm } from "../../../pipeline/llm/llm";
import { WEB_SEARCH_TOOL } from "../../../pipeline/tool-calling/tools";
import { extractJsonObject } from "../../../pipeline/utils/jsonOutput";
import { SEARCH_SYSTEM_PROMPT_CLAIM_PROBABILITY, withSourceUrlInstruction } from "../../../pipeline/prompts/simple-bot/searchAgent";
import { CASCADE_COMMONNOTES_STRONG_MODEL } from "../../../pipeline/simple-bot/cascadeSearch";
import { LOGS_DIR } from "../runStore";

const SOURCE_LOG = join(LOGS_DIR, "eval-2026-10-20-0348", "ea-earning-to-give.0.json");
const SAMPLES = 5;
const PROBABILITY_FIELD = "- misleading_probability: your subjective probability, as a number from 0 to 1, that the claim is misleading in any way.";
const BOOLEAN_FIELD = "- misleading: true if the claim is misleading in any way, otherwise false.";
const PROBABILITY_JSON = "{ findings: string, misleading_probability: number }";
const BOOLEAN_JSON = "{ findings: string, misleading: boolean }";
const SENTENCE_WITHOUT_PEDANTIC = "The claim was automatically extracted and so it should be interpreted in the context. Avoid being pedantic.";

const ANSWERS_WITH_PROBABILITY = process.argv.includes("--probability");
const answerPrompt = ANSWERS_WITH_PROBABILITY ? SEARCH_SYSTEM_PROMPT_CLAIM_PROBABILITY : SEARCH_SYSTEM_PROMPT_CLAIM_PROBABILITY.replace(PROBABILITY_FIELD, BOOLEAN_FIELD).replace(PROBABILITY_JSON, BOOLEAN_JSON);
const systemPrompt = withSourceUrlInstruction(answerPrompt.replace(SENTENCE_WITHOUT_PEDANTIC, "The claim was automatically extracted and so it should be interpreted in the context."));
const userMessage: string = JSON.parse(readFileSync(SOURCE_LOG, "utf8")).logs.note_writer_steps.search.messages["0"].userMessage;

async function main() {
  if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  console.log(`SYSTEM PROMPT\n${systemPrompt}\n\nUSER MESSAGE\n${userMessage}\n`);
  const answers = await Promise.all(
    Array.from({ length: SAMPLES }, async () => {
      const response = await llm.create({
        model: CASCADE_COMMONNOTES_STRONG_MODEL,
        tools: [WEB_SEARCH_TOOL],
        reasoning_effort: "medium",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
      } as any);
      const raw = (response as any).choices?.[0]?.message?.content ?? "";
      try {
        return JSON.parse(extractJsonObject(raw)) as { findings: string; misleading?: boolean; misleading_probability?: number };
      } catch {
        return { findings: `UNPARSEABLE: ${raw.slice(0, 300)}`, misleading: null, misleading_probability: undefined };
      }
    }),
  );
  answers.forEach((a, i) => console.log(`--- sample ${i + 1}: misleading = ${a.misleading ?? a.misleading_probability}\nlinks: ${(a.findings.match(/https:\/\/\S+/g) ?? []).length}\n${a.findings}\n`));
}

main();
