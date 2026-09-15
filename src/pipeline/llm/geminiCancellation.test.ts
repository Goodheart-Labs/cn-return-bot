import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import OpenAI from "openai";
import { DEFAULT_CONFIG, withBotConfig } from "../ab-testing/botConfig";
import { trackedLlmCreate } from "../cost-tracking/costTracker";
import { runJsonLlmCall } from "../utils/jsonLlmCall";
import * as gemini from "./gemini";
import { getLlmAbortSignal, llm, withDeadline, withLlmAbortSignal } from "./llm";

const envNames = ["GEMINI_API_KEY_FREE", "GEMINI_API_KEY", "GEMINI_FREE_ROUTING_DISABLED", "OPENROUTER_API_KEY"];
const savedEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
let fetch: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
let openRouter: ReturnType<typeof spyOn>;
let native: ReturnType<typeof spyOn<typeof gemini, "geminiNativeGenerateFree">> | undefined;
let warn: ReturnType<typeof spyOn<typeof console, "warn">>;

beforeEach(() => {
  process.env.GEMINI_API_KEY_FREE = "free-key-no-network";
  process.env.GEMINI_API_KEY = "paid-key-no-network";
  process.env.OPENROUTER_API_KEY = "openrouter-key-no-network";
  delete process.env.GEMINI_FREE_ROUTING_DISABLED;
  // The SDK captures fetch at construction; initialize before mocking it.
  void llm.list;
  fetch = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request"));
  openRouter = spyOn(OpenAI.prototype as any, "fetchWithTimeout").mockImplementation(() => {
    throw new Error("Unexpected OpenRouter request");
  });
  warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  native?.mockRestore();
  native = undefined;
  warn.mockRestore();
  openRouter.mockRestore();
  fetch.mockRestore();
  for (const name of envNames) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

const chatParams = {
  model: "google/gemini-3-flash-preview",
  messages: [{ role: "user" as const, content: "Check this post" }],
};

function nativeResponse(text: string) {
  return Response.json({
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  });
}

function quotaResponse() {
  return Response.json({ error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } }, { status: 429 });
}

describe("native Gemini cancellation", () => {
  test("a healthy scoped call still uses the free native key", async () => {
    fetch.mockResolvedValue(nativeResponse("free answer"));
    const result = await withLlmAbortSignal(new AbortController().signal, () => trackedLlmCreate("topic_filter.fallback", chatParams));
    expect(result.response.choices[0].message.content).toBe("free answer");
    expect(result.costEntry).toEqual({ name: "topic_filter.fallback", input_tokens: 10, output_tokens: 5, cost: 0, tools: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain("generativelanguage.googleapis.com");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("free-key-no-network");
    expect(openRouter).not.toHaveBeenCalled();
    expect(getLlmAbortSignal()).toBeUndefined();
  });

  test("a late malformed native reply cannot launch JSON repairs", async () => {
    native = spyOn(gemini, "geminiNativeGenerateFree").mockImplementation(async () => {
      await Bun.sleep(25);
      return { text: "not JSON", groundingChunks: [], searchCalls: 0, keyTier: "free", cost: { input_tokens: 1, output_tokens: 1, cost: 0 } };
    });
    const reason = new Error("gate expired");
    await expect(withBotConfig(DEFAULT_CONFIG, () => withDeadline(10, () => reason, signal =>
      withLlmAbortSignal(signal, () => runJsonLlmCall({
        ...chatParams, costName: "topic_filter.fallback", responseFormat: { type: "json_object" },
        schemaHint: '{"blocked":boolean,"reasoning":string}',
      })),
    ))).rejects.toBe(reason);
    await Bun.sleep(100);
    expect(native).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(openRouter).not.toHaveBeenCalled();
  });

  test("cancellation interrupts native retry backoff", async () => {
    fetch.mockResolvedValue(Response.json({ error: { code: 503, message: "Busy", status: "UNAVAILABLE" } }, { status: 503 }));
    const controller = new AbortController();
    const reason = new Error("gate expired");
    const started = Date.now();
    const timer = setTimeout(() => controller.abort(reason), 30);
    try {
      await expect(withLlmAbortSignal(controller.signal, () => gemini.geminiNativeGenerateFree({ model: "gemini-3-flash-preview", userMessage: "test" })))
        .rejects.toBe(reason);
      expect(Date.now() - started).toBeLessThan(500);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(openRouter).not.toHaveBeenCalled();
    } finally { clearTimeout(timer); }
  });

  test("a quota error after expiry cannot switch to the paid native key", async () => {
    const controller = new AbortController();
    const reason = new Error("gate expired");
    fetch.mockImplementation((async (_input: unknown, _init?: RequestInit) => {
      controller.abort(reason);
      return quotaResponse();
    }) as typeof globalThis.fetch);
    await expect(withLlmAbortSignal(controller.signal, () => gemini.geminiNativeGenerate({ model: "gemini-3-flash-preview", userMessage: "test" })))
      .rejects.toBe(reason);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(openRouter).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  test("quota exhaustion can still fall back to OpenRouter within the budget", async () => {
    fetch.mockResolvedValue(quotaResponse());
    openRouter.mockResolvedValue(Response.json({
      choices: [{ message: { content: "fallback answer" } }],
      usage: { prompt_tokens: 20, completion_tokens: 7, cost: 0.001 },
    }));
    const result = await withLlmAbortSignal(new AbortController().signal, () => trackedLlmCreate("topic_filter.fallback", chatParams));
    expect(result.response.choices[0].message.content).toBe("fallback answer");
    expect(result.costEntry.cost).toBe(0.001);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(openRouter).toHaveBeenCalledTimes(1);
  });

  test("an expired scope never starts another native call", async () => {
    const controller = new AbortController();
    const reason = new Error("gate expired");
    await withLlmAbortSignal(controller.signal, async () => {
      controller.abort(reason);
      await expect(trackedLlmCreate("topic_filter.fallback", chatParams)).rejects.toBe(reason);
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(openRouter).not.toHaveBeenCalled();
  });
});
