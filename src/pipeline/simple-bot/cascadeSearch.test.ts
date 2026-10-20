import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { DEFAULT_CONFIG, getBotConfig, withBotConfig, type BotConfig } from "../ab-testing/botConfig";
import { withCostTracker } from "../cost-tracking/costTracker";
import * as jsonLlm from "../utils/jsonLlmCall";
import {
  CASCADE_COMMONNOTES_STRONG_MODEL,
  CASCADE_WEAK_FALLBACK_MODEL,
  CASCADE_WEAK_MODEL,
  cascadeDecisionOf,
  runCascadingSearch,
} from "./cascadeSearch";
import * as search from "./search";

const claimConfig: BotConfig = { ...DEFAULT_CONFIG, botId: "simple-bot", commonnotes_pipeline: true, search_model: "openai/gpt-6-luna", web_search: "openrouter_native" };
const xConfig: BotConfig = { ...DEFAULT_CONFIG, botId: "simple-bot", search_model: "anthropic/claude-opus-5", web_search: "native" };

describe("cascadeDecisionOf", () => {
  test("0.9 and above goes to the writer", () => {
    expect(cascadeDecisionOf(0.9, false)).toBe("note");
    expect(cascadeDecisionOf(1, false)).toBe("note");
  });
  test("below 0.3 ends with no note, unless the run is on the audit arm", () => {
    expect(cascadeDecisionOf(0.2999, false)).toBe("no_note");
    expect(cascadeDecisionOf(0, false)).toBe("no_note");
    expect(cascadeDecisionOf(0.2999, true)).toBe("audit");
    expect(cascadeDecisionOf(0, true)).toBe("audit");
  });
  test("from 0.3 up to just below 0.9 escalates", () => {
    expect(cascadeDecisionOf(0.3, false)).toBe("escalate");
    expect(cascadeDecisionOf(0.8999, false)).toBe("escalate");
  });
});

describe("runCascadingSearch", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => spies.splice(0).forEach((s) => s.mockRestore()));

  function weakAnswers(...answers: Array<{ misleading_probability: number } | Error>) {
    const parse = spyOn(jsonLlm, "parseJsonWithRetry");
    for (const answer of answers) {
      if (answer instanceof Error) parse.mockRejectedValueOnce(answer);
      else parse.mockResolvedValueOnce({ findings: "The weak findings", ...answer } as never);
    }
    spies.push(parse);
    return parse;
  }

  function strongSearch() {
    const seen: BotConfig[] = [];
    const run = spyOn(search, "runSearch").mockImplementation(async () => {
      seen.push(getBotConfig());
      return { findings: "The strong findings", correctionNeeded: true };
    });
    spies.push(run);
    return { run, seen };
  }

  const run = (config: BotConfig) => withBotConfig(config, () => withCostTracker(() => runCascadingSearch("The claim")));

  test("a probability of 0.9 or more passes the weak findings on without the strong search", async () => {
    weakAnswers({ misleading_probability: 0.95 });
    const { run: strong } = strongSearch();
    expect(await run(claimConfig)).toMatchObject({ findings: "The weak findings", correctionNeeded: true, researchedBy: "quick" });
    expect(strong).not.toHaveBeenCalled();
  });

  test("a probability below 0.3 means no note and no strong search", async () => {
    weakAnswers({ misleading_probability: 0.1 });
    const { run: strong } = strongSearch();
    expect(await run(claimConfig)).toMatchObject({ findings: "The weak findings", correctionNeeded: false, researchedBy: "quick" });
    expect(strong).not.toHaveBeenCalled();
  });

  test("on the audit arm a claim below 0.3 is escalated anyway, and the stronger search decides", async () => {
    weakAnswers({ misleading_probability: 0.1 });
    const { run: strong, seen } = strongSearch();
    expect(await run({ ...claimConfig, cascade_audit: true })).toEqual({ findings: "The strong findings", correctionNeeded: true, researchedBy: "full" });
    expect(strong).toHaveBeenCalledTimes(1);
    expect(seen[0]).toMatchObject({ search_model: CASCADE_COMMONNOTES_STRONG_MODEL });
  });

  test("a claim in between escalates to Sonnet 5.5 at medium reasoning, answering whether the claim is misleading", async () => {
    weakAnswers({ misleading_probability: 0.5 });
    const { seen } = strongSearch();
    expect(await run(claimConfig)).toEqual({ findings: "The strong findings", correctionNeeded: true, researchedBy: "full" });
    expect(seen[0]).toMatchObject({ search_model: CASCADE_COMMONNOTES_STRONG_MODEL, web_search: "native", search_reasoning_effort: "medium", search_answer: "misleading" });
  });

  test("a post in between escalates to the search model the run was configured with, answering whether the post is misleading", async () => {
    weakAnswers({ misleading_probability: 0.5 });
    const { seen } = strongSearch();
    await run(xConfig);
    expect(seen[0]).toMatchObject({ search_model: "anthropic/claude-opus-5", web_search: "native", search_reasoning_effort: "medium", search_answer: "misleading" });
  });

  test("a post whose search provider cannot answer in the prompt keeps its own answer", async () => {
    weakAnswers({ misleading_probability: 0.5 });
    const { seen } = strongSearch();
    await run({ ...xConfig, search_model: "x-ai/grok-4.6", web_search: "native_grok" });
    expect(seen[0]?.search_answer).toBeUndefined();
  });

  test("the weak step asks Muse first and GPT-6 Luna when Muse fails", async () => {
    const parse = weakAnswers(new Error("Meta blocked us"), { misleading_probability: 0.95 });
    strongSearch();
    await run(claimConfig);
    expect(parse.mock.calls.map((call) => call[0].source)).toEqual([`cascadeWeakSearch(${CASCADE_WEAK_MODEL})`, `cascadeWeakSearch(${CASCADE_WEAK_FALLBACK_MODEL})`]);
  });
});
