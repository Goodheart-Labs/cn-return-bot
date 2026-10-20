import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { DEFAULT_CONFIG, withBotConfig, type BotConfig } from "../ab-testing/botConfig";
import { withCostTracker } from "../cost-tracking/costTracker";
import { CLAUDE_SOURCE_URL_INSTRUCTION, SEARCH_SYSTEM_PROMPT, SEARCH_SYSTEM_PROMPT_CLAIM, SEARCH_SYSTEM_PROMPT_CLAIM_MISLEADING, SEARCH_SYSTEM_PROMPT_CLAIM_PROBABILITY, SEARCH_SYSTEM_PROMPT_MISLEADING, SEARCH_SYSTEM_PROMPT_PROBABILITY, withSourceUrlInstruction } from "../prompts/simple-bot/searchAgent";
import * as jsonLlm from "../utils/jsonLlmCall";
import { dispatchSearch, getSearchSystemPrompt } from "./searchDispatch";

const claimConfig: BotConfig = { ...DEFAULT_CONFIG, botId: "simple-bot", commonnotes_pipeline: true, search_model: "anthropic/claude-sonnet-5.5", web_search: "native" };

describe("a search that answers whether the claim is misleading", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => spies.splice(0).forEach((s) => s.mockRestore()));

  function modelAnswers(content: string) {
    const parse = spyOn(jsonLlm, "parseJsonWithRetry").mockImplementation((async (params: { parse: (raw: string) => unknown }) => params.parse(content)) as never);
    spies.push(parse);
    return parse;
  }
  const search = (config: BotConfig) => withBotConfig(config, () => withCostTracker(() => dispatchSearch("The claim", "search")));

  test("uses the misleading prompt for a claim and for a post", () => {
    expect(withBotConfig({ ...claimConfig, search_answer: "misleading" }, getSearchSystemPrompt)).toBe(SEARCH_SYSTEM_PROMPT_CLAIM_MISLEADING);
    expect(withBotConfig({ ...claimConfig, commonnotes_pipeline: false, search_answer: "misleading" }, getSearchSystemPrompt)).toBe(SEARCH_SYSTEM_PROMPT_MISLEADING);
  });

  test("the misleading claim prompt asks for a boolean and does not tell the model to avoid being pedantic", () => {
    expect(SEARCH_SYSTEM_PROMPT_CLAIM_MISLEADING).toContain("{ findings: string, misleading: boolean }");
    expect(SEARCH_SYSTEM_PROMPT_CLAIM_MISLEADING).not.toContain("misleading_probability");
    expect(SEARCH_SYSTEM_PROMPT_CLAIM_MISLEADING).not.toContain("pedantic");
    expect(SEARCH_SYSTEM_PROMPT_CLAIM_PROBABILITY).toContain("pedantic");
  });

  test("a misleading answer decides whether a note is needed", async () => {
    modelAnswers(JSON.stringify({ findings: "f", misleading: true }));
    expect(await search({ ...claimConfig, search_answer: "misleading" })).toMatchObject({ correctionNeeded: true });
    modelAnswers(JSON.stringify({ findings: "f", misleading: false }));
    expect(await search({ ...claimConfig, search_answer: "misleading" })).toMatchObject({ correctionNeeded: false });
  });

  test("an answer without the misleading field is rejected", async () => {
    modelAnswers(JSON.stringify({ findings: "f", correction_needed: true }));
    await expect(search({ ...claimConfig, search_answer: "misleading" })).rejects.toThrow("answer field");
    modelAnswers(JSON.stringify({ findings: "f", misleading: 0.7 }));
    await expect(search({ ...claimConfig, search_answer: "misleading" })).rejects.toThrow("answer field");
  });

  test("the default answer is still correction_needed", async () => {
    modelAnswers(JSON.stringify({ findings: "f", correction_needed: true }));
    expect((await search(claimConfig)).correctionNeeded).toBe(true);
  });
});

describe("the source URL instruction", () => {
  test("goes in front of the output format section of every research prompt", () => {
    for (const prompt of [SEARCH_SYSTEM_PROMPT, SEARCH_SYSTEM_PROMPT_CLAIM, SEARCH_SYSTEM_PROMPT_PROBABILITY, SEARCH_SYSTEM_PROMPT_CLAIM_PROBABILITY, SEARCH_SYSTEM_PROMPT_MISLEADING, SEARCH_SYSTEM_PROMPT_CLAIM_MISLEADING]) {
      const result = withSourceUrlInstruction(prompt);
      expect(result.indexOf(CLAUDE_SOURCE_URL_INSTRUCTION)).toBeGreaterThan(-1);
      expect(result.indexOf(CLAUDE_SOURCE_URL_INSTRUCTION)).toBeLessThan(result.indexOf("## Output format"));
    }
  });
});
