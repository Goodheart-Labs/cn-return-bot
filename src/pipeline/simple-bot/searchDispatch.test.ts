import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { DEFAULT_CONFIG, withBotConfig, type BotConfig } from "../ab-testing/botConfig";
import { withCostTracker } from "../cost-tracking/costTracker";
import { CLAUDE_SOURCE_URL_INSTRUCTION, SEARCH_SYSTEM_PROMPT, SEARCH_SYSTEM_PROMPT_CLAIM, SEARCH_SYSTEM_PROMPT_CLAIM_PROBABILITY, SEARCH_SYSTEM_PROMPT_PROBABILITY, withSourceUrlInstruction } from "../prompts/simple-bot/searchAgent";
import * as jsonLlm from "../utils/jsonLlmCall";
import { dispatchSearch, getSearchSystemPrompt, PROBABILITY_NOTE_AT_OR_ABOVE } from "./searchDispatch";

const claimConfig: BotConfig = { ...DEFAULT_CONFIG, botId: "simple-bot", commonnotes_pipeline: true, search_model: "anthropic/claude-sonnet-5.5", web_search: "native" };

describe("a search that answers with a probability", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => spies.splice(0).forEach((s) => s.mockRestore()));

  function modelAnswers(content: string) {
    const parse = spyOn(jsonLlm, "parseJsonWithRetry").mockImplementation((async (params: { parse: (raw: string) => unknown }) => params.parse(content)) as never);
    spies.push(parse);
    return parse;
  }
  const search = (config: BotConfig) => withBotConfig(config, () => withCostTracker(() => dispatchSearch("The claim", "search")));

  test("uses the probability prompt for a claim and for a post", () => {
    expect(withBotConfig({ ...claimConfig, search_answer: "probability" }, getSearchSystemPrompt)).toBe(SEARCH_SYSTEM_PROMPT_CLAIM_PROBABILITY);
    expect(withBotConfig({ ...claimConfig, commonnotes_pipeline: false, search_answer: "probability" }, getSearchSystemPrompt)).toBe(SEARCH_SYSTEM_PROMPT_PROBABILITY);
  });

  test("needs a note from the threshold up and keeps the probability", async () => {
    modelAnswers(JSON.stringify({ findings: "f", misleading_probability: PROBABILITY_NOTE_AT_OR_ABOVE }));
    expect(await search({ ...claimConfig, search_answer: "probability" })).toMatchObject({ correctionNeeded: true, probability: PROBABILITY_NOTE_AT_OR_ABOVE });
    modelAnswers(JSON.stringify({ findings: "f", misleading_probability: 0.1 }));
    expect(await search({ ...claimConfig, search_answer: "probability" })).toMatchObject({ correctionNeeded: false, probability: 0.1 });
  });

  test("an answer without a probability, or with one outside 0 to 1, is rejected", async () => {
    modelAnswers(JSON.stringify({ findings: "f", correction_needed: true }));
    await expect(search({ ...claimConfig, search_answer: "probability" })).rejects.toThrow("answer field");
    modelAnswers(JSON.stringify({ findings: "f", misleading_probability: 1.5 }));
    await expect(search({ ...claimConfig, search_answer: "probability" })).rejects.toThrow("answer field");
  });

  test("the default answer is still correction_needed, with no probability", async () => {
    modelAnswers(JSON.stringify({ findings: "f", correction_needed: true }));
    const result = await search(claimConfig);
    expect(result.correctionNeeded).toBe(true);
    expect(result.probability).toBeUndefined();
  });
});

describe("the source URL instruction", () => {
  test("goes in front of the output format section of every research prompt", () => {
    for (const prompt of [SEARCH_SYSTEM_PROMPT, SEARCH_SYSTEM_PROMPT_CLAIM, SEARCH_SYSTEM_PROMPT_PROBABILITY, SEARCH_SYSTEM_PROMPT_CLAIM_PROBABILITY]) {
      const result = withSourceUrlInstruction(prompt);
      expect(result.indexOf(CLAUDE_SOURCE_URL_INSTRUCTION)).toBeGreaterThan(-1);
      expect(result.indexOf(CLAUDE_SOURCE_URL_INSTRUCTION)).toBeLessThan(result.indexOf("## Output format"));
    }
  });
});
