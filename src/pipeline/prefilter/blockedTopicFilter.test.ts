import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { getBotConfig } from "../ab-testing/botConfig";
import * as costs from "../cost-tracking/costTracker";
import * as deadlines from "../llm/llm";
import { TOPIC_FILTER_SYSTEM_PROMPT } from "../prompts/prefilter/blockedTopics";
import * as jsonLlm from "../utils/jsonLlmCall";
import { createTweetLog, withTweetLog } from "../utils/tweetLog";
import { getWarnings, withWarnings } from "../utils/warnings";
import { runBlockedTopicFilter } from "./blockedTopicFilter";

const PRIMARY = "deepseek/deepseek-v4-flash";
const FALLBACK = "google/gemini-3-flash-preview";
const realWithDeadline = deadlines.withDeadline;
let call: ReturnType<typeof spyOn<typeof jsonLlm, "runJsonLlmCall">>;
let deadline: ReturnType<typeof spyOn<typeof deadlines, "withDeadline">>;
let tracked: ReturnType<typeof spyOn<typeof costs, "trackedLlmCreate">>;
let warning: ReturnType<typeof spyOn<typeof console, "warn">>;

afterEach(() => {
  call?.mockRestore();
  deadline?.mockRestore();
  tracked?.mockRestore();
  warning?.mockRestore();
});

function shortenDeadlines() {
  deadline = spyOn(deadlines, "withDeadline").mockImplementation((budget, onTimeout, fn) =>
    realWithDeadline(Math.min(budget, 20), onTimeout, fn));
  warning = spyOn(console, "warn").mockImplementation(() => {});
}

describe("blocked-topic filter", () => {
  for (const blocked of [true, false]) {
    test(`preserves a valid primary verdict (${blocked}) without a fallback`, async () => {
      const verdict = { blocked, reasoning: "The topic was checked." };
      call = spyOn(jsonLlm, "runJsonLlmCall").mockResolvedValue(verdict);
      const log = createTweetLog();

      expect(await withTweetLog(log, () => runBlockedTopicFilter("The post"))).toEqual(verdict);
      expect(call).toHaveBeenCalledTimes(1);
      expect(call.mock.calls[0]![0].model).toBe(PRIMARY);
      expect(log.get("topic_filter.verdict")).toEqual(verdict);
      expect(log.get("topic_filter.fallbackReason")).toBeUndefined();
    });
  }

  test("aborts a stalled primary and gives the fallback a fresh, bounded scope", async () => {
    shortenDeadlines();
    let primarySignal: AbortSignal | undefined;
    let fallbackSignal: AbortSignal | undefined;
    const verdict = { blocked: true, reasoning: "This is explicitly excluded." };
    call = spyOn(jsonLlm, "runJsonLlmCall")
      .mockImplementationOnce(() => {
        primarySignal = deadlines.getLlmAbortSignal();
        return new Promise(() => {});
      })
      .mockImplementationOnce(async <T>() => {
        fallbackSignal = deadlines.getLlmAbortSignal();
        expect(primarySignal?.aborted).toBe(true);
        expect(fallbackSignal?.aborted).toBe(false);
        expect(getBotConfig().model).toBe(FALLBACK);
        expect(getBotConfig().reasoning_effort).toBe("low");
        return verdict as T;
      });
    const log = createTweetLog();

    await withWarnings(async () => {
      expect(await withTweetLog(log, () => runBlockedTopicFilter("The post"))).toEqual(verdict);
      expect(getWarnings()).toEqual([
        expect.stringContaining(`${PRIMARY} failed; trying ${FALLBACK}`),
      ]);
      expect(getWarnings()[0]).toContain("30s");
    });
    expect(deadline.mock.calls.map(([budget]) => budget)).toEqual([30_000, 20_000]);
    expect(fallbackSignal).not.toBe(primarySignal);
    expect(deadlines.getLlmAbortSignal()).toBeUndefined();
    expect(log.get("topic_filter.model")).toBe(FALLBACK);
    expect(log.get("topic_filter.fallbackReason")).toContain("30s");
    expect(log.get("topic_filter.attempts.0.error")).toContain("30s");
    expect(log.get("topic_filter.messages.0")).toEqual({
      systemPrompt: TOPIC_FILTER_SYSTEM_PROMPT, userMessage: "The post", model: FALLBACK,
    });
    expect(warning).toHaveBeenCalledTimes(1);
  });

  test("two stalled providers fail open with a warning", async () => {
    shortenDeadlines();
    const signals: AbortSignal[] = [];
    call = spyOn(jsonLlm, "runJsonLlmCall").mockImplementation(() => {
      signals.push(deadlines.getLlmAbortSignal()!);
      return new Promise(() => {});
    });
    const log = createTweetLog();

    await withWarnings(async () => {
      const verdict = await withTweetLog(log, () => runBlockedTopicFilter("The post"));
      expect(verdict.blocked).toBe(false);
      expect(verdict.reasoning).toContain("failing open");
      expect(getWarnings()).toHaveLength(2);
      expect(getWarnings()[1]).toContain(`model ${FALLBACK} did not answer within 20s`);
    });
    expect(call).toHaveBeenCalledTimes(2);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(log.get("topic_filter.failedOpen")).toBe(true);
    expect(log.get("topic_filter.error")).toContain("20s");
    expect(warning).toHaveBeenCalledTimes(2);
  });

  for (const invalid of [{}, { blocked: "false", reasoning: "No" }, { blocked: 0, reasoning: "No" },
    { blocked: false }, null]) {
    test(`treats invalid verdict ${JSON.stringify(invalid)} as a failure, not a verdict`, async () => {
      warning = spyOn(console, "warn").mockImplementation(() => {});
      call = spyOn(jsonLlm, "runJsonLlmCall").mockResolvedValue(invalid);
      const log = createTweetLog();

      const verdict = await withTweetLog(log, () => runBlockedTopicFilter("The post"));
      expect(call).toHaveBeenCalledTimes(2);
      expect(verdict.blocked).toBe(false);
      expect(verdict.reasoning).toContain("failing open");
      expect(log.get("topic_filter.error")).toContain("expected a boolean blocked verdict and string reasoning");
      expect(log.get("topic_filter.failedOpen")).toBe(true);
    });
  }

  test("retains both provider costs and the unchanged exclusions when fallback succeeds", async () => {
    warning = spyOn(console, "warn").mockImplementation(() => {});
    tracked = spyOn(costs, "trackedLlmCreate").mockImplementation(async (name, params) => ({
      response: { choices: [{ message: { content: params.model === PRIMARY
        ? "{}" : JSON.stringify({ blocked: false, reasoning: "No excluded topic." }) } }] },
      costEntry: { name, input_tokens: 10, output_tokens: 5, cost: 0.001, tools: [] },
    }));
    const log = createTweetLog();
    await costs.withCostTracker(async () => {
      expect(await withTweetLog(log, () => runBlockedTopicFilter("The post")))
        .toEqual({ blocked: false, reasoning: "No excluded topic." });
      expect(costs.getCostTracker().map(entry => entry.name)).toEqual(["topic_filter", "topic_filter.fallback"]);
      expect(costs.getCostTracker().reduce((sum, entry) => sum + entry.cost, 0)).toBe(0.002);
    });
    expect(tracked.mock.calls.map(([, params]) => params.model)).toEqual([PRIMARY, FALLBACK]);
    for (const [, params] of tracked.mock.calls) {
      expect(params.messages[0]!.content).toBe(TOPIC_FILTER_SYSTEM_PROMPT);
    }
    expect(log.get("topic_filter.fallbackReason")).toContain("expected a boolean blocked verdict");
  });

  test("fails open when both providers error, keeping both reasons", async () => {
    warning = spyOn(console, "warn").mockImplementation(() => {});
    call = spyOn(jsonLlm, "runJsonLlmCall")
      .mockRejectedValueOnce(new Error("primary unavailable"))
      .mockRejectedValueOnce(new Error("fallback provider unavailable"));
    const log = createTweetLog();

    const verdict = await withTweetLog(log, () => runBlockedTopicFilter("The post"));
    expect(verdict.blocked).toBe(false);
    expect(log.get("topic_filter.verdict")).toEqual(verdict);
    expect(log.get("topic_filter.fallbackReason")).toContain("primary unavailable");
    expect(log.get("topic_filter.error")).toContain("fallback provider unavailable");
  });
});
