import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { DEFAULT_CONFIG, withBotConfig, type BotConfig } from "../ab-testing/botConfig";
import { withCostTracker } from "../cost-tracking/costTracker";
import * as jsonLlm from "../utils/jsonLlmCall";
import { reviseResearch, secondRoundMessage } from "./secondRound";

const verification = { accepted: false, reasoning: "The Texas claim has no source.", good_sources: ["https://good.example"], bad_sources: ["https://bad.example"] } as any;

describe("secondRoundMessage", () => {
  const message = secondRoundMessage({ noteText: "The rejected note", verification });

  test("holds the rejected note and the verifier's answer, and nothing the researcher already has", () => {
    expect(message).toContain("The rejected note");
    expect(message).toContain("The Texas claim has no source.");
    expect(message).not.toContain("Your earlier research");
  });

  test("lists the good and the bad sources when the verifier gave no per-source detail", () => {
    expect(message).toContain("https://good.example");
    expect(message).toContain("https://bad.example");
  });
});

describe("reviseResearch", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => spies.splice(0).forEach((s) => s.mockRestore()));

  /** Answers every research call with the given JSON and keeps the messages that each call was given. */
  function researcherAnswers(answer: object) {
    const seen: { role: string; content: unknown }[][] = [];
    spies.push(
      spyOn(jsonLlm, "parseJsonWithRetry").mockImplementation((async (params: { messages: { role: string; content: unknown }[]; parse: (raw: string) => unknown }) => {
        seen.push(params.messages);
        return params.parse(JSON.stringify(answer));
      }) as never),
    );
    return seen;
  }
  const revise = (config: BotConfig, answer?: string) =>
    withBotConfig(config, () => withCostTracker(() => reviseResearch({ userMessage: "The first message", findings: "The first findings", answer, researchedBy: "full", noteText: "The rejected note", verification })));
  const config: BotConfig = { ...DEFAULT_CONFIG, botId: "simple-bot", commonnotes_pipeline: true, search_model: "anthropic/claude-sonnet-5.5", web_search: "native" };

  test("continues the conversation of the first research: its first message, its own answer, then the follow-up", async () => {
    const seen = researcherAnswers({ findings: "The revised findings", correction_needed: true });
    const result = await revise(config, '{"findings":"The first findings","correction_needed":true}');
    expect(result).toEqual({ findings: "The revised findings", withdrew: false });
    const roles = seen[0]!.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(JSON.stringify(seen[0]![1])).toContain("The first message");
    expect(seen[0]![2]!.content).toBe('{"findings":"The first findings","correction_needed":true}');
    expect(seen[0]![3]!.content).toContain("The rejected note");
  });

  test("marks the first message as a cache breakpoint on Anthropic, so that the follow-up reads it from the cache", async () => {
    const seen = researcherAnswers({ findings: "f", correction_needed: true });
    await revise(config);
    expect(JSON.stringify(seen[0]![1])).toContain("cache_control");
  });

  test("rebuilds the first answer from the findings when it was not kept", async () => {
    const seen = researcherAnswers({ findings: "f", correction_needed: true });
    await revise(config);
    expect(seen[0]![2]!.content).toBe(JSON.stringify({ findings: "The first findings" }));
  });

  test("a provider that cannot take a follow-up fails loudly", async () => {
    researcherAnswers({ findings: "f", correction_needed: true });
    await expect(revise({ ...config, web_search: "native_grok" })).rejects.toThrow("cannot take a follow-up");
  });
});
