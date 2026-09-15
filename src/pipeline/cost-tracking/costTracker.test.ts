import { afterEach, expect, spyOn, test } from "bun:test";
import OpenAI from "openai";
import * as geminiAdapter from "../llm/geminiChatAdapter";
import { getLlmAbortSignal, withLlmAbortSignal } from "../llm/llm";
import { trackedLlmCreate } from "./costTracker";

const originalApiKey = process.env.OPENROUTER_API_KEY;
const restores: Array<() => void> = [];
afterEach(() => {
  restores.splice(0).reverse().forEach(restore => restore());
  if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalApiKey;
});

test("Gemini uses cancellable OpenRouter inside a budget and native routing afterwards", async () => {
  process.env.OPENROUTER_API_KEY = "local-test-only";
  const nativeResponse = { choices: [{ message: { content: "native answer" } }] };
  const native = spyOn(geminiAdapter, "tryGeminiFreeChat").mockResolvedValue({
    response: nativeResponse,
    cost: { input_tokens: 10, output_tokens: 5, cost: 0 },
  });
  restores.push(() => native.mockRestore());

  // Exercise the real llm wrapper and SDK, intercepting the transport before
  // any network request. This also works if another test initialized its client.
  let requestSignal: AbortSignal | undefined;
  const transport = spyOn(OpenAI.prototype as any, "fetchWithTimeout").mockImplementation(async (_url: unknown, init: RequestInit) => {
    requestSignal = init.signal ?? undefined;
    return Response.json({
      choices: [{ message: { content: "OpenRouter answer" } }],
      usage: { prompt_tokens: 20, completion_tokens: 7, cost: 0.001 },
    });
  });
  restores.push(() => transport.mockRestore());

  const params = { model: "google/gemini-3-flash-preview", messages: [{ role: "user" as const, content: "Check this claim" }] };
  const controller = new AbortController();
  const scoped = await withLlmAbortSignal(controller.signal, () => trackedLlmCreate("topic_filter.fallback", params));
  expect(native).not.toHaveBeenCalled();
  expect(transport).toHaveBeenCalledTimes(1);
  expect(requestSignal).toBeInstanceOf(AbortSignal);
  expect(scoped.response.choices[0].message.content).toBe("OpenRouter answer");
  expect(scoped.costEntry).toEqual({ name: "topic_filter.fallback", input_tokens: 20, output_tokens: 7, cost: 0.001, tools: [] });
  expect(getLlmAbortSignal()).toBeUndefined();

  const unscoped = await trackedLlmCreate("writer", params);
  expect(native).toHaveBeenCalledTimes(1);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(unscoped.response).toBe(nativeResponse);
  expect(unscoped.costEntry).toEqual({ name: "writer", input_tokens: 10, output_tokens: 5, cost: 0, tools: [] });
});
