import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { setTimeout as sleep } from "node:timers/promises";
import { getCostTracker, trackLlmCall, withCostTracker } from "../cost-tracking/costTracker";
import { getLlmAbortSignal } from "../llm/llm";
import { SERPER_COST_PER_SEARCH } from "../cost-tracking/pricing";
import * as search from "../tool-calling/tools";
import * as jsonLlm from "../utils/jsonLlmCall";
import { createTweetLog, getTweetLog, withTweetLog } from "../utils/tweetLog";
import { getWarnings, withWarnings } from "../utils/warnings";
import { runNoteNeededPrefilter } from "./noteNeededPrefilter";
import * as queries from "./queryWriter";
import * as satire from "./satireDetector";
import * as analyzer from "./searchAnalyzer";
import type { Post } from "../../api/fetchEligiblePosts";
import { outcomeToResult } from "../../bots/types";
import { DEFAULT_CONFIG, withBotConfig } from "../ab-testing/botConfig";
import * as botInput from "../input/createBotInput";
import * as userMessage from "../prompts/input/userMessage";
import * as evaluation from "../score/noteEvaluationFilter";
import * as materiality from "../orchestration/materialityJudge";
import { computeTweetResult } from "../orchestration/processTweet";
import * as prefilter from "./noteNeededPrefilter";

const restores: Array<() => void> = [];
function keep<T extends { mockRestore(): void }>(spy: T): T {
  restores.push(() => spy.mockRestore());
  return spy;
}
afterEach(() => restores.splice(0).reverse().forEach(restore => restore()));

function ordinarySearch() {
  keep(spyOn(satire, "runSatireDetector").mockResolvedValue({ isSatire: false, reasoning: "A factual claim" }));
  keep(spyOn(queries, "runQueryWriter").mockResolvedValue({ queries: ["the claim"] }));
  keep(spyOn(search, "fetchSearchResults").mockResolvedValue([
    { title: "Source", url: "https://example.com/source", content: "Evidence", publishedDate: null },
  ]));
  keep(spyOn(analyzer, "runSearchAnalyzer").mockResolvedValue("Research brief"));
}

describe("note-needed prefilter deadline", () => {
  test("aborts a stalled model, fails open and retains completed costs and diagnostics", async () => {
    const log = createTweetLog();
    keep(spyOn(satire, "runSatireDetector").mockImplementation(async () => {
      getTweetLog()?.set("note_writer_steps.satire_detector.messages.1", { is_satire: false });
      trackLlmCall({ name: "satire_detector", input_tokens: 10, output_tokens: 5, cost: 0.001, tools: [] });
      return { isSatire: false, reasoning: "A factual claim" };
    }));
    let requestSignal: AbortSignal | undefined;
    const writer = keep(spyOn(queries, "runQueryWriter").mockImplementation(async () => {
      requestSignal = getLlmAbortSignal();
      await sleep(10_000, undefined, { signal: requestSignal });
      return { queries: [] };
    }));
    const fetch = keep(spyOn(search, "fetchSearchResults").mockResolvedValue([]));
    await withWarnings(() => withCostTracker(() => withTweetLog(log, async () => {
      const started = Date.now();
      const verdict = await runNoteNeededPrefilter("The post", { deadlineMs: 30 });
      expect(verdict.needsNote).toBe(true);
      expect(verdict.reasoning).toContain("failing open");
      expect(Date.now() - started).toBeLessThan(1000);
      expect(requestSignal?.aborted).toBe(true);
      expect(getLlmAbortSignal()).toBeUndefined();
      expect(getCostTracker()).toEqual([
        { name: "note_prefilter.satire_detector", input_tokens: 10, output_tokens: 5, cost: 0.001, tools: [] },
      ]);
      expect(getWarnings()).toEqual([verdict.reasoning]);
    })));
    expect(writer).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(log.get("note_prefilter_steps.timeout")).toEqual({ deadlineMs: 30, stage: "query_writer", action: "fail_open" });
    expect(log.get("note_prefilter_steps.satire_detector.messages.1")).toEqual({ is_satire: false });
  });

  test("empty-query retries share one budget and cannot continue after timeout", async () => {
    keep(spyOn(satire, "runSatireDetector").mockResolvedValue({ isSatire: false, reasoning: "factual" }));
    const writer = keep(spyOn(queries, "runQueryWriter").mockImplementation(async () => {
      // Deliberately ignore cancellation to check the guard between stages.
      await sleep(25);
      return { queries: [] };
    }));
    const verdict = await runNoteNeededPrefilter("The post", { deadlineMs: 40 });
    expect(verdict.needsNote).toBe(true);
    await sleep(40);
    expect(writer).toHaveBeenCalledTimes(2);
  });

  test("a stalled search is cancelled and never launches the analyzer", async () => {
    keep(spyOn(satire, "runSatireDetector").mockResolvedValue({ isSatire: false, reasoning: "factual" }));
    keep(spyOn(queries, "runQueryWriter").mockResolvedValue({ queries: ["one", "two"] }));
    let requestSignal: AbortSignal | undefined;
    const fetch = keep(spyOn(search, "fetchSearchResults").mockImplementation(async (_query, signal) => {
      requestSignal = signal;
      await sleep(10_000, undefined, { signal });
      return [];
    }));
    const analyze = keep(spyOn(analyzer, "runSearchAnalyzer").mockResolvedValue("unused"));
    expect((await runNoteNeededPrefilter("The post", { deadlineMs: 30 })).needsNote).toBe(true);
    expect(requestSignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(analyze).not.toHaveBeenCalled();
  });

  test("real negative verdicts still reject", async () => {
    ordinarySearch();
    keep(spyOn(jsonLlm, "runJsonLlmCall").mockResolvedValue({ note_needed: false, reasoning: "Sources support the post" }));
    expect(await runNoteNeededPrefilter("The post")).toEqual({ needsNote: false, reasoning: "Sources support the post" });
  });

  test("satire still skips research", async () => {
    keep(spyOn(satire, "runSatireDetector").mockResolvedValue({ isSatire: true, reasoning: "An explicit joke" }));
    const writer = keep(spyOn(queries, "runQueryWriter").mockResolvedValue({ queries: [] }));
    expect((await runNoteNeededPrefilter("The post")).needsNote).toBe(false);
    expect(writer).not.toHaveBeenCalled();
  });

  test("three timely empty-query verdicts still reject", async () => {
    keep(spyOn(satire, "runSatireDetector").mockResolvedValue({ isSatire: false, reasoning: "An opinion" }));
    const writer = keep(spyOn(queries, "runQueryWriter").mockResolvedValue({ queries: [] }));
    expect((await runNoteNeededPrefilter("The post")).needsNote).toBe(false);
    expect(writer).toHaveBeenCalledTimes(3);
  });

  test("ordinary errors propagate while preserving completed costs", async () => {
    keep(spyOn(satire, "runSatireDetector").mockImplementation(async () => {
      trackLlmCall({ name: "satire_detector", input_tokens: 1, output_tokens: 1, cost: 0.001, tools: [] });
      throw new Error("Bad response schema");
    }));
    await withCostTracker(async () => {
      await expect(runNoteNeededPrefilter("The post")).rejects.toThrow("Bad response schema");
      expect(getCostTracker()).toHaveLength(1);
    });
  });

  test("a timed-out gate reaches the bot, whose failed source verification still rejects", async () => {
    const actualPrefilter = prefilter.runNoteNeededPrefilter;
    keep(spyOn(prefilter, "runNoteNeededPrefilter").mockImplementation(message => actualPrefilter(message, { deadlineMs: 30 })));
    keep(spyOn(satire, "runSatireDetector").mockImplementation(async () => {
      await sleep(10_000, undefined, { signal: getLlmAbortSignal() });
      return { isSatire: false, reasoning: "unused" };
    }));
    keep(spyOn(botInput, "createBotInput").mockResolvedValue({} as Awaited<ReturnType<typeof botInput.createBotInput>>));
    keep(spyOn(userMessage, "buildUserMessageFromInput").mockReturnValue("The post"));
    keep(spyOn(evaluation, "getEvaluationScore").mockResolvedValue({ score: 0.9 }));
    keep(spyOn(materiality, "runMaterialityJudge").mockResolvedValue([]));
    const post = { id: "123", text: "The post" } as Post;
    const botRun = mock(async () => {
      expect(getLlmAbortSignal()).toBeUndefined();
      return outcomeToResult(post, "test-bot", {
        type: "verification_failed", noteText: "A draft correction", sources: ["https://example.com/source"],
        reason: "The cited source does not support this correction",
      });
    });
    const output = await withWarnings(() => withCostTracker(() => withTweetLog(createTweetLog(), () =>
      withBotConfig({ ...DEFAULT_CONFIG, topic_filter: false, note_prefilter: true }, () => computeTweetResult(post, {
        id: "test-bot", name: "Test", description: "Test", runPipeline: botRun,
      })),
    )));
    expect(botRun).toHaveBeenCalledTimes(1);
    expect(output.outcome).toBe("rejected");
    expect(output.outcomeReason).toBe("check_failed");
    expect(output.warnings?.some(warning => warning.includes("failing open"))).toBe(true);
  });
});

describe("note-needed prefilter search cost", () => {
  test("records one Serper fee for each search that returned, and none for a failed one", async () => {
    keep(spyOn(satire, "runSatireDetector").mockResolvedValue({ isSatire: false, reasoning: "A factual claim" }));
    keep(spyOn(queries, "runQueryWriter").mockResolvedValue({ queries: ["fails", "works"] }));
    keep(spyOn(search, "fetchSearchResults").mockImplementation(async (query) => {
      if (query === "fails") throw new Error("Serper HTTP 500");
      return [{ title: "Source", url: "https://example.com/source", content: "Evidence", publishedDate: null }];
    }));
    keep(spyOn(analyzer, "runSearchAnalyzer").mockResolvedValue("Research brief"));
    keep(spyOn(jsonLlm, "runJsonLlmCall").mockResolvedValue({ note_needed: true, reasoning: "Needs a note" }));
    await withCostTracker(async () => {
      await runNoteNeededPrefilter("The post");
      expect(getCostTracker().filter((entry) => entry.name.endsWith(".serper"))).toEqual([
        { name: "note_prefilter.fetch_and_format_search.serper", input_tokens: 0, output_tokens: 0, cost: SERPER_COST_PER_SEARCH, tools: [] },
      ]);
    });
  });
});
